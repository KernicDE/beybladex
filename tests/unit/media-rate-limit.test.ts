// tests/unit/media-rate-limit.test.ts
// Regression test for https://github.com/KernicDE/beybladex/issues/38: the generic media route
// (which also serves avatars) stays public BY DECISION, but must be rate-limited per client IP
// so avatar/asset ids cannot be bulk-downloaded unbounded.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const rateLimit = vi.fn()
const mediaAssetFindUnique = vi.fn()
const readMediaFile = vi.fn()

vi.mock('@/lib/rateLimit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }))
vi.mock('@/lib/db', () => ({
  prisma: { mediaAsset: { findUnique: (...a: unknown[]) => mediaAssetFindUnique(...a) } },
}))
vi.mock('@/lib/media', () => ({ readMediaFile: (...a: unknown[]) => readMediaFile(...a) }))
// [RC5 #62] the route caches asset metadata in Redis — mock the seam so no real client connects.
const redisGet = vi.fn()
const redisSet = vi.fn()
vi.mock('@/lib/redis', () => ({ redis: { get: (...a: unknown[]) => redisGet(...a), set: (...a: unknown[]) => redisSet(...a) } }))

import { GET } from '@/app/api/media/[id]/route'

const params = Promise.resolve({ id: 'asset-1' })
const ASSET = { mimeType: 'image/webp' } // prisma select: { mimeType: true } — no id column

beforeEach(() => {
  vi.clearAllMocks()
  mediaAssetFindUnique.mockResolvedValue(ASSET)
  readMediaFile.mockResolvedValue(Buffer.from('fake-image-bytes'))
  redisGet.mockResolvedValue(null)
  redisSet.mockResolvedValue('OK')
})

describe('GET /api/media/[id] rate limiting (issue #38)', () => {
  it('returns 429 without touching the DB/volume when the limiter denies', async () => {
    rateLimit.mockResolvedValue({ allowed: false, remaining: 0 })

    const res = await GET(new Request('http://localhost/api/media/asset-1'), { params })

    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'rate_limited' })
    expect(mediaAssetFindUnique).not.toHaveBeenCalled()
    expect(readMediaFile).not.toHaveBeenCalled()
  })

  it('serves the asset when the limiter allows (public access preserved)', async () => {
    rateLimit.mockResolvedValue({ allowed: true, remaining: 299 })

    const res = await GET(new Request('http://localhost/api/media/asset-1'), { params })

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('image/webp')
    // [RC5 #62] shared-cache contract: immutable bytes + s-maxage/stale-while-revalidate so a
    // CDN/reverse proxy in front can serve repeat hits without touching the app.
    expect(res.headers.get('Cache-Control')).toBe(
      'public, max-age=31536000, immutable, s-maxage=31536000, stale-while-revalidate=86400'
    )
    // Keyed per client IP (last XFF hop), so one scraper cannot mint fresh buckets.
    expect(rateLimit).toHaveBeenCalledWith('media:get:unknown', 300, 60)
    // Miss → metadata cached for the next request.
    expect(redisSet).toHaveBeenCalledWith('media:meta:asset-1', JSON.stringify({ mimeType: 'image/webp' }), 'EX', 300)
  })

  it('serves from the metadata cache without touching the DB (issue #62)', async () => {
    rateLimit.mockResolvedValue({ allowed: true, remaining: 299 })
    redisGet.mockResolvedValue(JSON.stringify({ mimeType: 'image/webp' }))

    const res = await GET(new Request('http://localhost/api/media/asset-1'), { params })

    expect(res.status).toBe(200)
    expect(mediaAssetFindUnique).not.toHaveBeenCalled()
    expect(readMediaFile).toHaveBeenCalledWith('asset-1')
  })

  it('short-TTL negative cache: unknown ids 404 without a DB round-trip', async () => {
    rateLimit.mockResolvedValue({ allowed: true, remaining: 299 })
    redisGet.mockResolvedValue('0')

    const res = await GET(new Request('http://localhost/api/media/asset-1'), { params })

    expect(res.status).toBe(404)
    expect(mediaAssetFindUnique).not.toHaveBeenCalled()
    expect(readMediaFile).not.toHaveBeenCalled()
  })
})
