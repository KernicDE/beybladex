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

import { GET } from '@/app/api/media/[id]/route'

const params = Promise.resolve({ id: 'asset-1' })
const ASSET = { id: 'asset-1', mimeType: 'image/webp' }

beforeEach(() => {
  vi.clearAllMocks()
  mediaAssetFindUnique.mockResolvedValue(ASSET)
  readMediaFile.mockResolvedValue(Buffer.from('fake-image-bytes'))
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
    expect(res.headers.get('Cache-Control')).toContain('immutable')
    // Keyed per client IP (last XFF hop), so one scraper cannot mint fresh buckets.
    expect(rateLimit).toHaveBeenCalledWith('media:get:unknown', 300, 60)
  })
})
