// lib/geo.ts (Phase 3)
// Geo helpers for the DACH tournament calendar: great-circle distance and postal-code
// geocoding. Everything here is server-side only.
import { redis } from '@/lib/redis'

const EARTH_RADIUS_KM = 6371

export interface GeoPoint {
  lat: number
  lng: number
}

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

// ---------------------------------------------------------------------------
// Postal-code geocoding
//
// Provider: the public Nominatim instance (https://nominatim.openstreetmap.org), the one
// no-API-key geocoder whose usage policy permits low-volume server-side single-address
// lookups (https://operations.osmfoundation.org/policies/nominatim/): a descriptive
// User-Agent (set below), at most 1 request/second (enforced cluster-wide via a Redis lock),
// and result caching (done in Redis below with a long TTL — postal codes don't move, so no
// per-request external call ever leaks user IP patterns or hammers the service).
//
// Compliance notes for whoever touches this next:
// - Nominatim results are OpenStreetMap data: any UI surfacing them outside the Leaflet map
//   (which already renders the attribution control) must show "© OpenStreetMap contributors".
// - If lookup volume ever outgrows the 1 req/s politeness budget, do NOT relax the lock —
//   self-host Nominatim or switch to a paid provider with a DPA. That is a deliberate
//   operational decision, not a code tweak.
// ---------------------------------------------------------------------------

const GEOCODE_TTL_SECONDS = 180 * 24 * 60 * 60 // ~6 months
const RATE_LIMIT_KEY = 'geocode:ratelimit'
const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search'
const USER_AGENT = 'beybladex.de/1.0 (DACH tournament radius search; +https://beybladex.de)'
const COUNTRY_CODES: Record<'DE' | 'AT' | 'CH', string> = { DE: 'de', AT: 'at', CH: 'ch' }

export async function geocodePostalCode(
  country: 'DE' | 'AT' | 'CH',
  postalCode: string,
): Promise<GeoPoint | null> {
  const normalized = postalCode.trim()
  // DACH postal codes are 4 (AT/CH) or 5 (DE) digits. Anything else is not worth an upstream call.
  if (!/^\d{4,5}$/.test(normalized)) return null

  const cacheKey = `geocode:v1:${country}:${normalized}`
  const cached = await redis.get(cacheKey)
  if (cached) {
    try {
      const parsed = JSON.parse(cached) as GeoPoint
      if (typeof parsed.lat === 'number' && typeof parsed.lng === 'number') return parsed
    } catch {
      // corrupted cache entry — fall through and re-fetch
    }
  }

  // Nominatim usage policy: absolute maximum 1 request/second. Serialize cluster-wide.
  const acquired = await redis.set(RATE_LIMIT_KEY, '1', 'EX', 1, 'NX')
  if (!acquired) return null // politeness over coverage; caller treats null as "no result"

  try {
    const url = new URL(NOMINATIM_SEARCH_URL)
    url.searchParams.set('format', 'jsonv2')
    url.searchParams.set('limit', '1')
    url.searchParams.set('countrycodes', COUNTRY_CODES[country])
    url.searchParams.set('postalcode', normalized)
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'de' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const results = (await res.json()) as Array<{ lat?: string; lon?: string }>
    const first = results[0]
    const lat = Number(first?.lat)
    const lng = Number(first?.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    if (lat < 45 || lat > 55 || lng < 5 || lng > 16) return null // outside DACH-ish bbox
    const point = { lat, lng }
    await redis.set(cacheKey, JSON.stringify(point), 'EX', GEOCODE_TTL_SECONDS)
    return point
  } catch {
    // network error / timeout / malformed response — radius features degrade gracefully
    return null
  }
}
