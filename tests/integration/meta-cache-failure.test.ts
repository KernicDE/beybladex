// tests/integration/meta-cache-failure.test.ts
// [RC2 #54] recomputeDirtyMeta drains the dirty sets BEFORE writing the recomputed cache values.
// A failed cache write used to lose both: the new values AND the dirty marks — pending
// recomputes silently vanished until some unrelated completion re-marked the ids. The fix
// restores the popped ids (SADD back) whenever the pipeline fails — on a rejected exec() AND on
// per-command errors (ioredis exec() RESOLVES with [err, result] tuples for failed commands).
// Integration — CI-only (real Redis for the dirty sets; real Prisma for the recompute queries).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { redis } from '@/lib/redis'
import { recomputeDirtyMeta, markMetaDirty, DIRTY_BUILDS_KEY, DIRTY_PARTS_KEY } from '@/lib/metaCache'

describe('recomputeDirtyMeta cache-write failure', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('keeps the dirty marks when the pipeline write rejects', async () => {
    const suffix = Date.now().toString(36)
    const buildId = `mcf_b_${suffix}`
    const partId = `mcf_p_${suffix}`
    await markMetaDirty([buildId], [partId])

    vi.spyOn(redis, 'pipeline').mockReturnValue({
      set: vi.fn(),
      exec: vi.fn().mockRejectedValue(new Error('redis down')),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    const result = await recomputeDirtyMeta()
    expect(result).toMatchObject({ builds: 1, parts: 1 })

    // The dirty marks must SURVIVE the failed write — the next pass retries these ids.
    expect(await redis.sismember(DIRTY_BUILDS_KEY, buildId)).toBe(1)
    expect(await redis.sismember(DIRTY_PARTS_KEY, partId)).toBe(1)

    // With the real pipeline again, the retry drains the set and writes the (zero-appearance)
    // cache entries — proving the restored ids are processed normally.
    const retry = await recomputeDirtyMeta()
    expect(retry).toMatchObject({ builds: 1, parts: 1 })
    expect(await redis.sismember(DIRTY_BUILDS_KEY, buildId)).toBe(0)
    expect(await redis.sismember(DIRTY_PARTS_KEY, partId)).toBe(0)
    const cached = JSON.parse((await redis.get(`meta:build:${buildId}`))!)
    expect(cached).toMatchObject({ id: buildId, appearances: 0, wins: 0, losses: 0, winRate: null })

    await redis.del(`meta:build:${buildId}`, `meta:part:${partId}`)
  })

  it('keeps the dirty marks when individual pipeline commands fail (exec resolves with errors)', async () => {
    const suffix = Date.now().toString(36)
    const buildId = `mcf2_b_${suffix}`
    await markMetaDirty([buildId], [])

    vi.spyOn(redis, 'pipeline').mockReturnValue({
      set: vi.fn(),
      // ioredis semantics: exec() resolves with one [err, result] tuple per command.
      exec: vi.fn().mockResolvedValue([[new Error('READONLY'), null]]),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    await recomputeDirtyMeta()
    expect(await redis.sismember(DIRTY_BUILDS_KEY, buildId)).toBe(1)

    vi.restoreAllMocks()
    await recomputeDirtyMeta() // retry with the real pipeline — drains and writes
    expect(await redis.sismember(DIRTY_BUILDS_KEY, buildId)).toBe(0)
    await redis.del(`meta:build:${buildId}`)
  })
})
