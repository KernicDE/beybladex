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

self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return
  event.respondWith(
    fetchWithTimeout(event.request).catch(async () => {
      const cache = await caches.open(CACHE_NAME)
      return (await cache.match(event.request)) ?? (await cache.match(OFFLINE_URL))
    })
  )
})
