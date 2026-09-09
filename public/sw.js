// public/sw.js
// Cache name is versioned per build so Phase 6's auto-deploys never leave a device serving
// chunk references from a prior build (see plan Global Constraints + Phase 6).
// __SW_BUILD_ID__ is a placeholder token — scripts/inject-sw-build-id.js (npm prebuild) replaces
// it with a fresh value (a base36 timestamp) when public/sw.js is emitted, so every deploy ships
// a distinct cache namespace. The committed source of truth keeps the literal placeholder.
const BUILD_ID = '__SW_BUILD_ID__'
const CACHE_NAME = `beybladex-shell-${BUILD_ID}`
const OFFLINE_URL = '/offline.html'
const PRECACHE_URLS = [OFFLINE_URL]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)))
  // Deliberately do NOT self.skipWaiting() here: a judge device mid-tournament should keep its
  // currently-active SW/cache until the page is reloaded or the tournament session ends, rather
  // than being force-updated under it. RegisterServiceWorker.tsx surfaces an "update available"
  // prompt instead (Phase 5 Part C wires the judge-specific UX for this).
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
  )
})

// Generic shell-level fetch handling: network-first with a bounded timeout (a hung TCP connect
// on a flaky hall connection must not block navigation for tens of seconds), falling back to the
// offline document for navigations only. Phase 5 Part C adds a SEPARATE, additional fetch listener
// for the judge route's full asset closure and IndexedDB-backed data hydration — this handler
// stays generic and must not be deleted or narrowed when that listener is added.
const NETWORK_TIMEOUT_MS = 4000

function fetchWithTimeout(request) {
  return Promise.race([
    fetch(request),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS)),
  ])
}

// ---------------------------------------------------------------------------
// Phase 5 Part C — judge-route offline layer ([REVIEW-FIX: frontend-pwa C1, I2]).
// APPENDED listener (the generic handler above stays untouched except for the judge fall-through
// guard): the judge UI uses cache-first-with-background-revalidation — on spotty hall wifi a
// hung TCP connect is worse than a clean offline hit, so the judge document, its RSC/data
// fetches (same URL, RSC headers), and the build-hashed /_next/static asset closure are served
// from cache immediately while a fresh copy is fetched in the background.
const JUDGE_DOC_RE = /^\/tournaments\/[^/]+\/judge/

function isJudgeScopedRequest(url) {
  return url.origin === self.location.origin && JUDGE_DOC_RE.test(url.pathname)
}

function isStaticAsset(url) {
  // Build-hashed chunks are immutable per build — safe to cache-first globally; the judge page
  // cannot hydrate offline without them ([REVIEW-FIX: frontend-pwa C1]).
  return url.origin === self.location.origin && url.pathname.startsWith('/_next/static/')
}

function cacheFirstWithRevalidation(request) {
  return caches.open(CACHE_NAME).then(async (cache) => {
    const cached = await cache.match(request, { ignoreSearch: false })
    const revalidate = fetch(request)
      .then((response) => {
        if (response.ok) cache.put(request, response.clone())
        return response
      })
      .catch(() => null) // offline / hung connect — the cached copy (if any) is authoritative
    if (cached) {
      void revalidate
      return cached
    }
    const fresh = await revalidate
    if (fresh) return fresh
    // Nothing cached and no network: judge navigations fall back to the offline document.
    return (await cache.match(OFFLINE_URL)) ?? Response.error()
  })
}

self.addEventListener('fetch', (event) => {
  // Guard only: judge-scoped requests fall through to the appended cache-first listener below.
  // (A fetch event may only be responded to once, and listeners run in registration order.)
  const url = new URL(event.request.url)
  if (!isJudgeScopedRequest(url) && !isStaticAsset(url)) return
  if (event.request.method !== 'GET') return
  event.respondWith(cacheFirstWithRevalidation(event.request))
})

// ---------------------------------------------------------------------------
// Background Sync — PROGRESSIVE ENHANCEMENT ONLY ([REVIEW-FIX: frontend-pwa I1]): the `sync`
// event is Chrome/Edge/Android-only and a no-op on iOS Safari. The authoritative cross-platform
// triggers are the page-side ones in lib/offline/matchQueue.ts (online / page load /
// visibilitychange); this handler exists so an Android judge tab killed between scoring and
// reconnect still flushes. It re-implements the same idempotent full-state POST loop (a SW
// cannot import the page's TS module) against the same IndexedDB store.
const SW_QUEUE_DB = 'beybladex-offline'
const SW_QUEUE_STORE = 'matchQueue'
const SW_SYNC_TAG = 'beybladex-match-sync'

function swTx(db, store, mode, run) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode)
    const request = run(t.objectStore(store))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function swOpenQueueDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SW_QUEUE_DB, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(SW_QUEUE_STORE)) {
        db.createObjectStore(SW_QUEUE_STORE, { keyPath: 'seq', autoIncrement: true })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function swBackoffMs(attempts) {
  return Math.min(1000 * 2 ** Math.max(0, attempts - 1), 5 * 60 * 1000)
}

async function flushQueueInSw() {
  let db
  try {
    db = await swOpenQueueDb()
  } catch {
    return // IndexedDB unavailable — the page-side triggers will flush on next open.
  }
  const now = Date.now()
  const due = (await swTx(db, SW_QUEUE_STORE, 'readonly', (s) => s.getAll()))
    .filter((e) => (e.status === 'pending' || e.status === 'failed') && e.nextAttemptAt <= now)
    .sort((a, b) => a.seq - b.seq)
  for (const entry of due) {
    // Per-item error isolation, same as the page-side flush.
    try {
      const res = await fetch(`/api/matches/${entry.matchId}/score`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(entry.payload),
      })
      if (res.ok) {
        await swTx(db, SW_QUEUE_STORE, 'readwrite', (s) => s.delete(entry.seq))
      } else if (res.status === 409) {
        await swTx(db, SW_QUEUE_STORE, 'readwrite', (s) => s.put({ ...entry, status: 'failed', lastError: 'conflict' }))
      } else {
        await swTx(db, SW_QUEUE_STORE, 'readwrite', (s) =>
          s.put({ ...entry, status: 'pending', attempts: entry.attempts + 1, nextAttemptAt: now + swBackoffMs(entry.attempts + 1), lastError: `http_${res.status}` })
        )
      }
    } catch {
      await swTx(db, SW_QUEUE_STORE, 'readwrite', (s) =>
        s.put({ ...entry, status: 'pending', attempts: entry.attempts + 1, nextAttemptAt: now + swBackoffMs(entry.attempts + 1), lastError: 'network_error' })
      )
    }
  }
}

self.addEventListener('sync', (event) => {
  if (event.tag === SW_SYNC_TAG) event.waitUntil(flushQueueInSw())
})

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return
  // Phase 5 Part C: judge-scoped navigations are handled by the appended cache-first listener
  // below (only one listener may respond to a fetch event; this guard makes them fall through).
  const url = new URL(event.request.url)
  if (/^\/tournaments\/[^/]+\/judge/.test(url.pathname)) return
  event.respondWith(
    fetchWithTimeout(event.request).catch(async () => {
      const cache = await caches.open(CACHE_NAME)
      return (await cache.match(event.request)) ?? (await cache.match(OFFLINE_URL))
    })
  )
})
