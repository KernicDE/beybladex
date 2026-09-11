// tests/unit/public-cache.test.ts (RC5 issue #43)
// withPublicCache contract, seam-mocked on '@/lib/redis' (no real Redis):
//  - hit path returns the cached value WITHOUT calling the producer
//  - Date values round-trip (Prisma rows carry Dates — a plain JSON cache would break
//    .toLocaleDateString() etc. on cache hits)
//  - null/undefined results are never cached (a just-created row must appear immediately)
//  - Redis failures degrade to running the query, never to an error
import { describe, it, expect, vi, beforeEach } from 'vitest'

const redisGet = vi.fn()
const redisSet = vi.fn()
const redisDel = vi.fn()
vi.mock('@/lib/redis', () => ({
  redis: {
    get: (...a: unknown[]) => redisGet(...a),
    set: (...a: unknown[]) => redisSet(...a),
    del: (...a: unknown[]) => redisDel(...a),
  },
}))

import { withPublicCache, invalidatePublicCache, publicTournamentKey } from '@/lib/publicCache'

beforeEach(() => {
  vi.clearAllMocks()
  redisGet.mockResolvedValue(null)
  redisSet.mockResolvedValue('OK')
  redisDel.mockResolvedValue(1)
})

describe('withPublicCache (issue #43)', () => {
  it('serves the producer result and caches it with the requested TTL', async () => {
    const produce = vi.fn().mockResolvedValue([{ id: 't1', startDate: new Date('2026-10-01T10:00:00Z') }])

    const first = await withPublicCache('public:v1:events:x', 60, produce)

    expect(first).toHaveLength(1)
    expect(redisSet).toHaveBeenCalledWith('public:v1:events:x', expect.any(String), 'EX', 60)
    expect(produce).toHaveBeenCalledTimes(1)
  })

  it('cache hit skips the producer and revives Date objects', async () => {
    redisGet.mockResolvedValue(JSON.stringify({ startDate: { $d: '2026-10-01T10:00:00.000Z' } }))
    const produce = vi.fn()

    const value = await withPublicCache<{ startDate: Date }>('public:v1:event:t1', 60, produce)

    expect(produce).not.toHaveBeenCalled()
    expect(value.startDate).toBeInstanceOf(Date)
    expect(value.startDate.toISOString()).toBe('2026-10-01T10:00:00.000Z')
  })

  it('does not cache null results (fresh creates must show up immediately)', async () => {
    const produce = vi.fn().mockResolvedValue(null)

    const value = await withPublicCache('public:v1:event:missing', 60, produce)

    expect(value).toBeNull()
    expect(redisSet).not.toHaveBeenCalled()
  })

  it('GET failure degrades to running the producer', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    redisGet.mockRejectedValue(new Error('ECONNREFUSED'))
    const produce = vi.fn().mockResolvedValue(['fresh'])

    const value = await withPublicCache('public:v1:clubs:y', 120, produce)

    expect(value).toEqual(['fresh'])
    expect(produce).toHaveBeenCalledTimes(1)
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('SET failure still returns the produced value', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    redisSet.mockRejectedValue(new Error('ECONNREFUSED'))
    const produce = vi.fn().mockResolvedValue(['fresh'])

    await expect(withPublicCache('public:v1:clubs:z', 120, produce)).resolves.toEqual(['fresh'])
    consoleError.mockRestore()
  })
})

describe('invalidatePublicCache (hotfix #99)', () => {
  it('DELs the exact public tournament detail key', async () => {
    await invalidatePublicCache(publicTournamentKey('t1'))
    expect(redisDel).toHaveBeenCalledWith('public:v2:tournament:t1')
  })

  it('degrades to a logged no-op when Redis fails — invalidation never throws', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    redisDel.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(invalidatePublicCache(publicTournamentKey('t1'))).resolves.toBeUndefined()
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
