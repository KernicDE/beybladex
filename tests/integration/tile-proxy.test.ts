// tests/integration/tile-proxy.test.ts
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { GET } from '@/app/api/map/tile/[z]/[x]/[y]/route'
import { redis, redisSubscriber } from '@/lib/redis'

// 1x1 transparent PNG
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)

describe('tile proxy', () => {
  beforeEach(async () => {
    // Ensure a cache miss regardless of leftover state from previous runs (14-day TTL).
    await redis.del('osm-tile:v1:1:1:1')
  })

  afterAll(() => {
    redis.disconnect()
    redisSubscriber.disconnect()
  })

  it('returns a PNG for a known tile and caches it in Redis', async () => {
    const fetchMock = vi.fn(
      async () => new Response(PNG_1X1, { headers: { 'content-type': 'image/png' } })
    )
    vi.stubGlobal('fetch', fetchMock)

    const req = new Request('http://localhost/api/map/tile/1/1/1')
    const first = await GET(req, { params: Promise.resolve({ z: '1', x: '1', y: '1' }) })
    expect(first.status).toBe(200)
    expect(first.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await first.arrayBuffer())).toEqual(PNG_1X1)

    // Second call must be served from the Redis cache without another upstream fetch.
    const second = await GET(req, { params: Promise.resolve({ z: '1', x: '1', y: '1' }) })
    expect(second.status).toBe(200)
    expect(second.headers.get('content-type')).toBe('image/png')
    expect(Buffer.from(await second.arrayBuffer())).toEqual(PNG_1X1)

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('returns 400 for an invalid zoom without calling fetch', async () => {
    const fetchMock = vi.fn(async () => new Response(PNG_1X1))
    vi.stubGlobal('fetch', fetchMock)

    const req = new Request('http://localhost/api/map/tile/99/1/1')
    const res = await GET(req, { params: Promise.resolve({ z: '99', x: '1', y: '1' }) })
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
