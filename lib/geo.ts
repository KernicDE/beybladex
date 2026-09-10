// lib/geo.ts (Phase 3; address autofill added in Phase 9)
// Geo helpers for the DACH tournament calendar and the tournament form's location
// autofill: great-circle distance, postal-code geocoding, free-text address search and
// full-address geocoding. Everything here is server-side only.
import { redis } from '@/lib/redis'
import { canonicalRegionName, DACH_REGIONS, normalizeRegionName, type DachCountry } from '@/lib/dachRegions'

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
const COUNTRY_CODES: Record<DachCountry, string> = { DE: 'de', AT: 'at', CH: 'ch' }
const SEARCH_COUNTRY_CODES = 'de,at,ch'

export type { DachCountry }

// Rough DACH bounding box — results outside it are discarded (mirrors the Phase 3 check).
const DACH_LAT_MIN = 45
const DACH_LAT_MAX = 55
const DACH_LNG_MIN = 5
const DACH_LNG_MAX = 16

/**
 * Shared Nominatim GET: Redis cache (long TTL — addresses don't move), the single
 * cluster-wide 1 req/s politeness lock, and the required User-Agent. ALL Nominatim calls
 * in this file go through here; never add a second fetch path (see the usage-policy notes
 * above). Returns the raw parsed result array, or null when the lock wasn't acquired /
 * the request failed — callers treat null as "no result", never as an error worth retrying.
 */
async function nominatimSearch(params: Record<string, string>, cacheKey: string): Promise<unknown[] | null> {
  const cached = await redis.get(cacheKey)
  if (cached) {
    try {
      const parsed: unknown = JSON.parse(cached)
      if (Array.isArray(parsed)) return parsed
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
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'de' },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const results: unknown = await res.json()
    if (!Array.isArray(results)) return null
    await redis.set(cacheKey, JSON.stringify(results), 'EX', GEOCODE_TTL_SECONDS)
    return results
  } catch {
    // network error / timeout / malformed response — geo features degrade gracefully
    return null
  }
}

function inDachBbox(lat: number, lng: number): boolean {
  return lat >= DACH_LAT_MIN && lat <= DACH_LAT_MAX && lng >= DACH_LNG_MIN && lng <= DACH_LNG_MAX
}

export async function geocodePostalCode(country: DachCountry, postalCode: string): Promise<GeoPoint | null> {
  const normalized = postalCode.trim()
  // DACH postal codes are 4 (AT/CH) or 5 (DE) digits. Anything else is not worth an upstream call.
  if (!/^\d{4,5}$/.test(normalized)) return null

  const results = await nominatimSearch(
    { limit: '1', countrycodes: COUNTRY_CODES[country], postalcode: normalized },
    `geocode:v2:postal:${country}:${normalized}`,
  )
  const first = results?.[0] as { lat?: unknown; lon?: unknown } | undefined
  const lat = Number(first?.lat)
  const lng = Number(first?.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (!inDachBbox(lat, lng)) return null
  return { lat, lng }
}

// ---------------------------------------------------------------------------
// Address autofill (Phase 9) — free-text address search and full-address geocoding
// for the tournament form. Same Nominatim integration, cache, lock and User-Agent as
// above. Results surfaced in the UI (the form's suggestion dropdown) must keep the
// "© OpenStreetMap contributors" attribution next to them.
// ---------------------------------------------------------------------------

export interface AddressSuggestion {
  displayName: string
  street: string | null
  postalCode: string | null
  city: string | null
  /** Canonical DACH region name (Bundesland/Kanton) when it could be determined. */
  state: string | null
  country: DachCountry
  lat: number
  lng: number
}

// Subset of Nominatim's jsonv2 `address` object that we read. OSM tagging is not uniform
// across DACH — city-class places appear as city/town/village/municipality, streets as
// road/pedestrian — so every read is a fallback chain.
interface NominatimAddress {
  house_number?: string
  road?: string
  pedestrian?: string
  postcode?: string
  city?: string
  town?: string
  village?: string
  municipality?: string
  state?: string
  county?: string
  country_code?: string
}

// Swiss district/county spellings that wrap the canton name ("Bezirk Zürich") or a
// district name containing it ("Verwaltungskreis Bern-Mittelland").
const CH_COUNTY_PREFIXES = ['bezirk ', 'kreis ', 'amtsbezirk ', 'verwaltungskreis ', 'wahlkreis ', 'district ']

/**
 * Determine the canonical region (Bundesland/Kanton) from a Nominatim address object.
 * DE/AT tag it reliably as address.state; CH usually tags only a district as address.county
 * — strip the district prefix and match the canton name, otherwise match the canton name
 * as a substring of the district name. Anything unmatched falls back to the raw
 * state/county string so the organizer can hand-correct it (Tournament.state is free text).
 */
export function extractDachState(country: DachCountry, address: NominatimAddress): string | null {
  const canonical = canonicalRegionName(country, address.state)
  if (canonical) return canonical

  if (country === 'CH' && address.county) {
    const county = address.county.trim()
    const lower = county.toLowerCase()
    for (const prefix of CH_COUNTY_PREFIXES) {
      if (lower.startsWith(prefix)) {
        const hit = canonicalRegionName('CH', county.slice(prefix.length))
        if (hit) return hit
      }
    }
    const needle = normalizeRegionName(county)
    const hit = DACH_REGIONS.CH.find((region) => needle.includes(normalizeRegionName(region.name)))
    if (hit) return hit.name
  }

  const raw = (address.state ?? address.county)?.trim()
  return raw ? raw : null
}

/** Pure parser for Nominatim jsonv2 results → structured, bbox- and country-filtered suggestions. */
export function parseAddressSuggestions(raw: unknown, limit = 5): AddressSuggestion[] {
  if (!Array.isArray(raw)) return []
  const suggestions: AddressSuggestion[] = []
  for (const entry of raw) {
    if (suggestions.length >= limit) break
    if (typeof entry !== 'object' || entry === null) continue
    const row = entry as {
      lat?: unknown
      lon?: unknown
      display_name?: unknown
      address?: NominatimAddress
    }
    const lat = Number(row.lat)
    const lng = Number(row.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    if (!inDachBbox(lat, lng)) continue
    const countryCode = typeof row.address?.country_code === 'string' ? row.address.country_code.toLowerCase() : ''
    if (countryCode !== 'de' && countryCode !== 'at' && countryCode !== 'ch') continue
    const address = row.address ?? {}
    const country = countryCode.toUpperCase() as DachCountry
    const road = address.road ?? address.pedestrian
    suggestions.push({
      displayName: typeof row.display_name === 'string' ? row.display_name : '',
      street: road ? `${road}${address.house_number ? ` ${address.house_number}` : ''}` : null,
      postalCode: address.postcode ?? null,
      city: address.city ?? address.town ?? address.village ?? address.municipality ?? null,
      state: extractDachState(country, address),
      country,
      lat,
      lng,
    })
  }
  return suggestions
}

/** Lowercase, whitespace-collapsed query form — used for cache keys and the min-length gate. */
export function normalizeAddressQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase()
}

const AUTOCOMPLETE_MIN_LENGTH = 3

/**
 * Free-text address search (Nominatim `q=`) for the tournament form's type-ahead.
 * Cached by normalized query string; shares the cluster-wide 1 req/s lock above.
 */
export async function searchAddresses(query: string, limit = 5): Promise<AddressSuggestion[]> {
  const normalized = normalizeAddressQuery(query)
  if (normalized.length < AUTOCOMPLETE_MIN_LENGTH) return []
  const results = await nominatimSearch(
    { q: normalized, limit: String(limit), countrycodes: SEARCH_COUNTRY_CODES, addressdetails: '1' },
    `geocode:v2:search:${limit}:${normalized}`,
  )
  return parseAddressSuggestions(results, limit)
}

export interface AddressQuery {
  street?: string
  postalCode?: string
  city: string
  country: DachCountry
}

/**
 * Full-address geocoding (Nominatim structured query) — the Phase 3 TODO: once
 * street+postalCode+city+country are known, resolve precise coordinates plus the canonical
 * region in one call. A city is the minimum viable lookup; street/postalCode refine it.
 * Cached by normalized address parts; shares the same lock and User-Agent.
 */
export async function geocodeAddress(query: AddressQuery): Promise<AddressSuggestion | null> {
  const street = query.street?.trim() ?? ''
  const postalCode = query.postalCode?.trim() ?? ''
  const city = query.city.trim()
  if (!city) return null

  const params: Record<string, string> = {
    limit: '1',
    countrycodes: COUNTRY_CODES[query.country],
    city,
    addressdetails: '1',
  }
  if (street) params.street = street
  if (postalCode) params.postalcode = postalCode

  const cacheKey = `geocode:v2:address:${query.country}:${normalizeAddressQuery([street, postalCode, city].join(' '))}`
  const results = await nominatimSearch(params, cacheKey)
  return parseAddressSuggestions(results, 1)[0] ?? null
}
