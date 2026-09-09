// lib/offline/matchQueue.ts
// Phase 5 Part C — offline-sync core for the judge UI ([REVIEW-FIX: frontend-pwa C2, I1, I3, I4]).
//
// IDEMPOTENT, FULL-STATE, SINGLE-FLIGHT queue backed by IndexedDB:
// - `enqueueScore(matchId, fullMatchState)` writes `{ seq: autoIncrement, clientEventId: uuid,
//   matchId, payload, status: 'pending' }`. The payload is the FULL match score state (never a
//   delta), so duplicate delivery is a server-side no-op overwrite, not a double-count.
// - `flushQueue()` is guarded by a single-flight flag: the four triggers (window `online`,
//   page load, `visibilitychange`→visible, and the SW's `sync` event — the SW re-implements
//   the same POST loop in public/sw.js since it cannot import this module) can fire
//   concurrently and must not double-flush. Background Sync is a no-op on iOS Safari, which is
//   exactly why page-load and visibilitychange triggers are wired here, not just `online`.
// - Per-item error isolation: a failed POST does NOT block later queue entries (no head-of-line
//   blocking). Failures retry with exponential backoff (2^n seconds, capped at 5 min); a 409
//   conflict (match completed by another judge) is parked as 'failed' for manual resolution.
// - Snapshots ([REVIEW-FIX: I4]): the last-fetched tournament/match payload is persisted on
//   every successful load so a reload while offline hydrates from IndexedDB instead of
//   rendering blank.
//
// Testability: the store and POST function are injectable — `flushQueue(deps)` and
// `doFlush(store, post, now)` run against any QueueStore, which is how tests/unit/matchQueue
// exercises ordering, isolation, backoff, and single-flight without a real IndexedDB.
export type MatchScoreState = {
  clientEventId: string
  event?: { type: string; player: 1 | 2 }
  scorePlayer1: number
  scorePlayer2: number
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED'
  winnerId?: string | null
  player1BuildId?: string
  player2BuildId?: string
}

export type QueueStatus = 'pending' | 'sending' | 'failed'

export type QueueEntry = {
  seq: number
  clientEventId: string
  matchId: string
  payload: MatchScoreState
  status: QueueStatus
  attempts: number
  /** epoch ms before which this entry must not be retried */
  nextAttemptAt: number
  lastError?: string
}

export interface QueueStore {
  listDue(now: number): Promise<QueueEntry[]>
  ack(entry: QueueEntry): Promise<void>
  markSending(entry: QueueEntry): Promise<void>
  markRetry(entry: QueueEntry, error: string, nextAttemptAt: number): Promise<void>
  markFailed(entry: QueueEntry, error: string): Promise<void>
  depth(): Promise<number>
}

export type FlushSummary = { attempted: number; synced: number; retried: number; parked: number }

const BACKOFF_BASE_MS = 1000
const BACKOFF_CAP_MS = 5 * 60 * 1000
export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_CAP_MS)
}

// Background Sync isn't in TS's lib.dom yet — declare the sliver we use.
interface SyncManager {
  register(tag: string): Promise<void>
}

function uuid(): string {
  const c = globalThis.crypto as Crypto | undefined
  if (c?.randomUUID) return c.randomUUID()
  // Fallback for non-secure contexts (rare; SW scope is secure, but tests/jsdom may lack it).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16)
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

// ---------------------------------------------------------------------------
// IndexedDB implementation
// ---------------------------------------------------------------------------

const DB_NAME = 'beybladex-offline'
const DB_VERSION = 1
const QUEUE_STORE = 'matchQueue'
const SNAPSHOT_STORE = 'snapshots'
// Must match SW_SYNC_TAG in public/sw.js — the SW's `sync` handler flushes this same queue.
const SW_SYNC_TAG = 'beybladex-match-sync'

function idb(): IDBFactory | null {
  return typeof indexedDB !== 'undefined' ? indexedDB : null
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const factory = idb()
    if (!factory) return reject(new Error('indexeddb_unavailable'))
    const request = factory.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: 'seq', autoIncrement: true })
      }
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        db.createObjectStore(SNAPSHOT_STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('idb_open_failed'))
  })
}

function tx<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode)
    const request = run(t.objectStore(store))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('idb_request_failed'))
  })
}

function idbStore(): QueueStore {
  return {
    async listDue(now) {
      const db = await openDb()
      const all = await tx<QueueEntry[]>(db, QUEUE_STORE, 'readonly', (s) => s.getAll() as IDBRequest<QueueEntry[]>)
      return all
        .filter((e) => (e.status === 'pending' || e.status === 'failed') && e.nextAttemptAt <= now)
        .sort((a, b) => a.seq - b.seq)
    },
    async ack(entry) {
      const db = await openDb()
      await tx(db, QUEUE_STORE, 'readwrite', (s) => s.delete(entry.seq))
    },
    async markSending(entry) {
      const db = await openDb()
      await tx(db, QUEUE_STORE, 'readwrite', (s) => s.put({ ...entry, status: 'sending' }))
    },
    async markRetry(entry, error, nextAttemptAt) {
      const db = await openDb()
      await tx(db, QUEUE_STORE, 'readwrite', (s) =>
        s.put({ ...entry, status: 'pending', attempts: entry.attempts + 1, nextAttemptAt, lastError: error })
      )
    },
    async markFailed(entry, error) {
      const db = await openDb()
      await tx(db, QUEUE_STORE, 'readwrite', (s) => s.put({ ...entry, status: 'failed', lastError: error }))
    },
    async depth() {
      const db = await openDb()
      const all = await tx<QueueEntry[]>(db, QUEUE_STORE, 'readonly', (s) => s.getAll() as IDBRequest<QueueEntry[]>)
      return all.filter((e) => e.status !== 'sending' || e.nextAttemptAt <= Date.now()).length
    },
  }
}

// ---------------------------------------------------------------------------
// Snapshots ([REVIEW-FIX: frontend-pwa I4])
// ---------------------------------------------------------------------------

export async function saveSnapshot(key: string, value: unknown): Promise<void> {
  const db = await openDb()
  await tx(db, SNAPSHOT_STORE, 'readwrite', (s) => s.put(value, key))
}

export async function loadSnapshot<T>(key: string): Promise<T | null> {
  const db = await openDb()
  const value = await tx<T | undefined>(db, SNAPSHOT_STORE, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>)
  return value ?? null
}

// ---------------------------------------------------------------------------
// Queue operations
// ---------------------------------------------------------------------------

export async function enqueueScore(matchId: string, fullMatchState: MatchScoreState): Promise<string> {
  const entry = {
    clientEventId: fullMatchState.clientEventId || uuid(),
    matchId,
    payload: fullMatchState,
    status: 'pending' as const,
    attempts: 0,
    nextAttemptAt: 0,
  }
  const db = await openDb()
  await tx(db, QUEUE_STORE, 'readwrite', (s) => s.add(entry))
  void notifyDepth()

  // Progressive enhancement: ask the SW to flush when connectivity returns. A no-op on iOS
  // Safari (no Background Sync API) — the page-side triggers are the real mechanism there.
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    void navigator.serviceWorker.ready
      .then((reg) => (reg as ServiceWorkerRegistration & { sync?: SyncManager }).sync?.register(SW_SYNC_TAG))
      .catch(() => {})
  }
  return entry.clientEventId
}

// Depth listeners — the judge UI's persistent "N scores pending sync" indicator.
type DepthListener = (depth: number) => void
const depthListeners = new Set<DepthListener>()
export function subscribeQueueDepth(listener: DepthListener): () => void {
  depthListeners.add(listener)
  void getQueueDepth().then(listener)
  return () => depthListeners.delete(listener)
}
async function notifyDepth() {
  const store = idbStore()
  const depth = await store.depth().catch(() => 0)
  depthListeners.forEach((l) => l(depth))
}

export async function getQueueDepth(): Promise<number> {
  return idbStore().depth()
}

type PostFn = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

const defaultPost: PostFn = (url, init) => fetch(url, init).then(async (r) => ({ ok: r.ok, status: r.status, json: () => r.json() }))

/** The flush core — store and POST are injectable for unit tests. */
export async function doFlush(store: QueueStore, post: PostFn, now: number): Promise<FlushSummary> {
  const summary: FlushSummary = { attempted: 0, synced: 0, retried: 0, parked: 0 }
  const due = await store.listDue(now)
  for (const entry of due) {
    summary.attempted++
    // Per-item error isolation: each entry is independent; a failure never blocks later ones.
    try {
      await store.markSending(entry)
      const res = await post(`/api/matches/${entry.matchId}/score`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(entry.payload),
      })
      if (res.ok) {
        await store.ack(entry)
        summary.synced++
      } else if (res.status === 409) {
        // Conflict: match completed by someone else — park for manual resolution, do not retry.
        await store.markFailed(entry, 'conflict')
        summary.parked++
      } else {
        await store.markRetry(entry, `http_${res.status}`, now + backoffMs(entry.attempts + 1))
        summary.retried++
      }
    } catch (error) {
      await store.markRetry(entry, error instanceof Error ? error.message : 'network_error', now + backoffMs(entry.attempts + 1))
      summary.retried++
    }
    void notifyDepth()
  }
  return summary
}

// Single-flight guard: concurrent triggers (online event + SW sync + page load +
// visibilitychange) share ONE in-flight flush.
let activeFlush: Promise<FlushSummary> | null = null

export function flushQueue(deps: { store?: QueueStore; post?: PostFn; now?: () => number } = {}): Promise<FlushSummary> {
  if (activeFlush) return activeFlush
  const store = deps.store ?? idbStore()
  const post = deps.post ?? defaultPost
  const now = deps.now ?? Date.now
  activeFlush = doFlush(store, post, now()).finally(() => {
    activeFlush = null
  })
  return activeFlush
}

// Wire the page-side triggers. The SW's `sync` event is a fifth trigger handled inside
// public/sw.js (a SW cannot import this module); it re-implements the same POST loop. iOS
// Safari has no Background Sync — page-load and visibilitychange are the real iOS recovery path.
export function initMatchQueue(): void {
  if (typeof window === 'undefined') return
  const trigger = () => void flushQueue()
  window.addEventListener('online', trigger)
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') trigger()
  })
  // Page load — catches scores queued in a previously killed/evicted tab (common on iOS).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', trigger, { once: true })
  } else {
    trigger()
  }
}
