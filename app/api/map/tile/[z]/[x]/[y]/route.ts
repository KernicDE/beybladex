// app/api/map/tile/[z]/[x]/[y]/route.ts
import { redis } from '@/lib/redis'

const CACHE_VERSION = 'v1'
const TTL_SECONDS = 60 * 60 * 24 * 14 // 14 days
const TILE_SERVERS = ['a', 'b', 'c']
const MAX_ZOOM = 19
// Per-instance single-flight map: concurrent requests for the same tile share one upstream fetch
// instead of stampeding OSM (Redis dedupes across time, not across concurrent misses).
const inFlight = new Map<string, Promise<Buffer | null>>()

function isValidTile(z: number, x: number, y: number): boolean {
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) return false
  if (z < 0 || z > MAX_ZOOM) return false
  const maxCoord = 2 ** z
  return x >= 0 && x < maxCoord && y >= 0 && y < maxCoord
}

async function fetchAndCache(cacheKey: string, z: number, x: number, y: number): Promise<Buffer | null> {
  const server = TILE_SERVERS[(x + y) % TILE_SERVERS.length]
  const upstream = await fetch(`https://${server}.tile.openstreetmap.org/${z}/${x}/${y}.png`, {
    headers: { 'User-Agent': 'BeybladeX.de tile proxy (contact: nicolas@kernic.net)' },
  })
  if (!upstream.ok) return null
  const buf = Buffer.from(await upstream.arrayBuffer())
  await redis.set(cacheKey, buf, 'EX', TTL_SECONDS)
  return buf
}

export async function GET(_req: Request, { params }: { params: Promise<{ z: string; x: string; y: string }> }) {
  const { z: zStr, x: xStr, y: yStr } = await params
  const z = Number(zStr)
  const x = Number(xStr)
  const y = Number(yStr.replace(/\.png$/, ''))

  if (!isValidTile(z, x, y)) {
    return new Response(null, { status: 400 })
  }

  const cacheKey = `osm-tile:${CACHE_VERSION}:${z}:${x}:${y}`

  const cached = await redis.getBuffer(cacheKey)
  if (cached) {
    return new Response(new Uint8Array(cached), { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' } })
  }

  // Single-flight: if a fetch for this exact tile is already in progress on this instance, await it.
  let pending = inFlight.get(cacheKey)
  if (!pending) {
    pending = fetchAndCache(cacheKey, z, x, y).finally(() => inFlight.delete(cacheKey))
    inFlight.set(cacheKey, pending)
  }
  const buf = await pending

  if (!buf) return new Response(null, { status: 502 })
  return new Response(new Uint8Array(buf), { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' } })
}
