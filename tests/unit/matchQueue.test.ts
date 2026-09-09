// tests/unit/matchQueue.test.ts
// Phase 5 Part C — offline queue semantics without a real IndexedDB: the flush core runs
// against an in-memory QueueStore and a stubbed POST ([REVIEW-FIX: frontend-pwa C2, I3]).
// Covers: in-order flush, per-item error isolation (no head-of-line blocking), exponential
// backoff on failure, 409 conflict parking (no silent retry loop), and single-flight (two
// concurrent flushQueue triggers share one run — the double-flush race is closed).
import { describe, it, expect } from 'vitest'
import { doFlush, flushQueue, backoffMs, type QueueEntry, type QueueStore, type MatchScoreState } from '@/lib/offline/matchQueue'

function state(clientEventId: string, score = 1): MatchScoreState {
  return { clientEventId, scorePlayer1: score, scorePlayer2: 0, status: 'IN_PROGRESS' }
}

function entry(seq: number, matchId: string, clientEventId: string, overrides: Partial<QueueEntry> = {}): QueueEntry {
  return { seq, matchId, clientEventId, payload: state(clientEventId), status: 'pending', attempts: 0, nextAttemptAt: 0, ...overrides }
}

function memoryStore(entries: QueueEntry[]) {
  const rows = new Map(entries.map((e) => [e.seq, { ...e }]))
  const store: QueueStore & { rows: Map<number, QueueEntry>; posts: unknown[] } = {
    rows,
    posts: [],
    async listDue(now) {
      return [...rows.values()]
        .filter((e) => (e.status === 'pending' || e.status === 'failed') && e.nextAttemptAt <= now)
        .sort((a, b) => a.seq - b.seq)
    },
    async ack(e) {
      rows.delete(e.seq)
    },
    async markSending(e) {
      rows.set(e.seq, { ...rows.get(e.seq)!, status: 'sending' })
    },
    async markRetry(e, error, nextAttemptAt) {
      rows.set(e.seq, { ...rows.get(e.seq)!, status: 'pending', attempts: e.attempts + 1, nextAttemptAt, lastError: error })
    },
    async markFailed(e, error) {
      rows.set(e.seq, { ...rows.get(e.seq)!, status: 'failed', lastError: error })
    },
    async depth() {
      return rows.size
    },
  }
  return store
}

function okPost() {
  return async () => ({ ok: true, status: 200, json: async () => ({}) })
}

describe('matchQueue flush semantics', () => {
  it('flushes due entries in seq order and acks them', async () => {
    const store = memoryStore([entry(3, 'm2', 'c2'), entry(1, 'm1', 'c1'), entry(2, 'm1', 'c1b')])
    const order: string[] = []
    const summary = await doFlush(store, async (_url, init) => {
      order.push((JSON.parse(String(init.body)) as MatchScoreState).clientEventId)
      return { ok: true, status: 200, json: async () => ({}) }
    }, 1000)
    expect(order).toEqual(['c1', 'c1b', 'c2']) // seq order, not insertion order
    expect(summary).toEqual({ attempted: 3, synced: 3, retried: 0, parked: 0 })
    expect(store.rows.size).toBe(0)
  })

  it('per-item error isolation: a failed POST does not block later entries', async () => {
    const store = memoryStore([entry(1, 'm1', 'bad'), entry(2, 'm2', 'good')])
    const summary = await doFlush(
      store,
      async (url) =>
        url.includes('m1')
          ? { ok: false, status: 500, json: async () => ({}) }
          : { ok: true, status: 200, json: async () => ({}) },
      1000
    )
    expect(summary).toEqual({ attempted: 2, synced: 1, retried: 1, parked: 0 })
    expect(store.rows.get(1)!.status).toBe('pending') // retried later, not dropped
    expect(store.rows.get(1)!.attempts).toBe(1)
    expect(store.rows.get(2)).toBeUndefined() // acked
  })

  it('retries with exponential backoff and respects nextAttemptAt', async () => {
    expect(backoffMs(1)).toBe(1000)
    expect(backoffMs(2)).toBe(2000)
    expect(backoffMs(3)).toBe(4000)
    const store = memoryStore([entry(1, 'm1', 'c1')])
    await doFlush(store, async () => ({ ok: false, status: 503, json: async () => ({}) }), 10_000)
    const row = store.rows.get(1)!
    expect(row.nextAttemptAt).toBe(10_000 + 1000) // attempts+1 → first backoff step
    // Not due yet → second flush at the same timestamp attempts nothing.
    const again = await doFlush(store, okPost(), 10_000)
    expect(again.attempted).toBe(0)
    // After the backoff window, it flushes.
    const later = await doFlush(store, okPost(), row.nextAttemptAt)
    expect(later.synced).toBe(1)
  })

  it('parks 409 conflicts as failed without retrying', async () => {
    const store = memoryStore([entry(1, 'm1', 'c1')])
    const summary = await doFlush(
      store,
      async () => ({ ok: false, status: 409, json: async () => ({ error: 'conflict' }) }),
      1000
    )
    expect(summary.parked).toBe(1)
    expect(summary.retried).toBe(0)
    expect(store.rows.get(1)).toMatchObject({ status: 'failed', lastError: 'conflict' })
  })

  it('network exceptions (offline flush attempt) reschedule, they do not crash the run', async () => {
    const store = memoryStore([entry(1, 'm1', 'c1'), entry(2, 'm2', 'c2')])
    const summary = await doFlush(
      store,
      async (url) => {
        if (url.includes('m1')) throw new Error('network_error')
        return { ok: true, status: 200, json: async () => ({}) }
      },
      5000
    )
    expect(summary).toEqual({ attempted: 2, synced: 1, retried: 1, parked: 0 })
  })

  it('single-flight: two concurrent flushQueue triggers share one run (double-flush closed)', async () => {
    const store = memoryStore([entry(1, 'm1', 'c1')])
    let postCount = 0
    const post = async () => {
      postCount++
      // Slow enough that both flushQueue calls overlap while the first is in flight.
      await new Promise((r) => setTimeout(r, 20))
      return { ok: true, status: 200, json: async () => ({}) }
    }
    const [a, b] = [flushQueue({ store, post, now: () => 1000 }), flushQueue({ store, post, now: () => 1000 })]
    expect(b).toBe(a) // same in-flight promise
    const [sa, sb] = await Promise.all([a, b])
    expect(sa.attempted).toBe(1)
    expect(sb.attempted).toBe(1)
    expect(postCount).toBe(1) // exactly one POST — not zero, not two
  })
})
