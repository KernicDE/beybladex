// tests/unit/geo-address.test.ts
// Phase 9: address-search response parsing (parseAddressSuggestions, extractDachState)
// against frozen Nominatim jsonv2 payloads, plus the cache/rate-limit behavior of
// searchAddresses/geocodeAddress/geocodePostalCode with Redis and fetch mocked — the
// pure halves here mirror the style of tests/unit/currency.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// In-memory Redis double honoring the NX semantics lib/geo.ts relies on for the
// cluster-wide 1 req/s Nominatim lock. Exported so tests can prime the lock key directly.
const hoisted = vi.hoisted(() => {
  const store = new Map<string, string>()
  return {
    store,
    redisMock: {
      get: async (key: string) => store.get(key) ?? null,
      set: async (key: string, value: string, ...args: Array<string | number>) => {
        if (args.includes('NX') && store.has(key)) return null
        store.set(key, value)
        return 'OK'
      },
    },
  }
})
vi.mock('@/lib/redis', () => ({ redis: hoisted.redisMock, redisSubscriber: {} }))

import {
  extractDachState,
  geocodeAddress,
  geocodePostalCode,
  normalizeAddressQuery,
  parseAddressSuggestions,
  searchAddresses,
} from '@/lib/geo'

// Frozen Nominatim jsonv2 results with addressdetails=1 — shapes verified against
// real /search responses for the three DACH countries (2026-09-10).
const DE_RESULT = {
  lat: '48.1371079',
  lon: '11.5753820',
  display_name: 'Marienplatz 1, 80331 München, Bayern, Deutschland',
  address: {
    house_number: '1',
    road: 'Marienplatz',
    postcode: '80331',
    city: 'München',
    state: 'Bayern',
    country_code: 'de',
  },
}

// Swiss results typically carry NO state — only a district as county.
const CH_RESULT_COUNTY = {
  lat: '47.3768866',
  lon: '8.5416940',
  display_name: 'Bahnhofstrasse 1, 8001 Zürich, Bezirk Zürich, Schweiz',
  address: {
    house_number: '1',
    road: 'Bahnhofstrasse',
    postcode: '8001',
    city: 'Zürich',
    county: 'Bezirk Zürich',
    country_code: 'ch',
  },
}

const AT_RESULT = {
  lat: '47.8000831',
  lon: '13.0469966',
  display_name: 'Getreidegasse 9, 5020 Salzburg, Österreich',
  address: {
    house_number: '9',
    road: 'Getreidegasse',
    postcode: '5020',
    city: 'Salzburg',
    state: 'Salzburg',
    country_code: 'at',
  },
}

// A small-town result where city-class is tagged as "village" instead of "city".
const DE_VILLAGE_RESULT = {
  lat: '47.7001',
  lon: '10.3162',
  display_name: 'Hauptstrasse, 87487 Wiggensbach, Bayern, Deutschland',
  address: {
    road: 'Hauptstrasse',
    postcode: '87487',
    village: 'Wiggensbach',
    state: 'Bayern',
    country_code: 'de',
  },
}

let nextPayload: unknown = []
const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
  new Response(JSON.stringify(nextPayload), { status: 200 }),
)
vi.stubGlobal('fetch', fetchMock)

function lastFetchedUrl(): URL {
  const call = fetchMock.mock.calls.at(-1)
  if (!call) throw new Error('fetch was not called')
  return new URL(String(call[0]))
}

beforeEach(() => {
  hoisted.store.clear()
  fetchMock.mockClear()
  nextPayload = []
})

describe('parseAddressSuggestions — frozen Nominatim payloads', () => {
  it('parses a German address into structured fields', () => {
    const [s] = parseAddressSuggestions([DE_RESULT])
    expect(s).toEqual({
      displayName: 'Marienplatz 1, 80331 München, Bayern, Deutschland',
      street: 'Marienplatz 1',
      postalCode: '80331',
      city: 'München',
      state: 'Bayern',
      country: 'DE',
      lat: 48.1371079,
      lng: 11.575382,
    })
  })

  it('resolves a Swiss canton from the county when no state is tagged', () => {
    const [s] = parseAddressSuggestions([CH_RESULT_COUNTY])
    expect(s.state).toBe('Zürich')
    expect(s.country).toBe('CH')
    expect(s.city).toBe('Zürich')
  })

  it('resolves Austrian state directly', () => {
    const [s] = parseAddressSuggestions([AT_RESULT])
    expect(s.state).toBe('Salzburg')
    expect(s.country).toBe('AT')
  })

  it('falls back through city-class tags (village/municipality/town)', () => {
    const [s] = parseAddressSuggestions([DE_VILLAGE_RESULT])
    expect(s.city).toBe('Wiggensbach')
    expect(s.street).toBe('Hauptstrasse') // no house number — no trailing space
  })

  it('filters out non-DACH countries and out-of-bbox coordinates', () => {
    const paris = { lat: '48.8566', lon: '2.3522', display_name: 'Paris', address: { country_code: 'fr' } }
    const tooFarNorth = { lat: '60.0', lon: '11.0', display_name: 'Oslo?', address: { country_code: 'de' } }
    expect(parseAddressSuggestions([paris, tooFarNorth, DE_RESULT])).toHaveLength(1)
  })

  it('drops entries with missing/malformed coordinates or address block', () => {
    const noCoords = { display_name: 'X', address: { country_code: 'de' } }
    const badCoords = { lat: 'abc', lon: '11.5', display_name: 'Y', address: { country_code: 'de' } }
    const noAddress = { lat: '48.1', lon: '11.5', display_name: 'Z' }
    expect(parseAddressSuggestions([noCoords, badCoords, noAddress])).toEqual([])
  })

  it('honours the limit and tolerates non-array input', () => {
    expect(parseAddressSuggestions([DE_RESULT, AT_RESULT, CH_RESULT_COUNTY], 2)).toHaveLength(2)
    expect(parseAddressSuggestions(null)).toEqual([])
    expect(parseAddressSuggestions({})).toEqual([])
  })
})

describe('extractDachState — per-country Nominatim tagging quirks', () => {
  it('DE/AT: uses address.state, canonicalized', () => {
    expect(extractDachState('DE', { state: 'Freistaat Bayern' })).toBe('Bayern')
    expect(extractDachState('AT', { state: 'Steiermark' })).toBe('Steiermark')
  })

  it('CH: strips district prefixes from county ("Bezirk Zürich" → Zürich)', () => {
    expect(extractDachState('CH', { county: 'Bezirk Zürich' })).toBe('Zürich')
    expect(extractDachState('CH', { county: 'Verwaltungskreis Bern-Mittelland' })).toBe('Bern')
    expect(extractDachState('CH', { county: 'Kanton Luzern' })).toBe('Luzern')
  })

  it('prefers state over county when both are tagged', () => {
    expect(extractDachState('CH', { state: 'Zürich', county: 'Bezirk Meilen' })).toBe('Zürich')
  })

  it('falls back to the raw string when nothing matches (stays hand-correctable)', () => {
    expect(extractDachState('CH', { county: 'Bezirk Meilen' })).toBe('Bezirk Meilen')
    expect(extractDachState('DE', { county: 'Landkreis München' })).toBe('Landkreis München')
    expect(extractDachState('DE', {})).toBeNull()
  })
})

describe('searchAddresses — cache, lock and query gating', () => {
  it('returns [] for queries under 3 characters without touching fetch', async () => {
    expect(await searchAddresses('  ab ')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('queries Nominatim with q=, DACH countrycodes and addressdetails, then parses', async () => {
    nextPayload = [DE_RESULT]
    const results = await searchAddresses('Marienplatz, München')
    expect(results).toHaveLength(1)
    expect(results[0].city).toBe('München')
    const url = lastFetchedUrl()
    expect(url.searchParams.get('q')).toBe('marienplatz, münchen')
    expect(url.searchParams.get('countrycodes')).toBe('de,at,ch')
    expect(url.searchParams.get('addressdetails')).toBe('1')
    expect(url.searchParams.get('format')).toBe('jsonv2')
    // The usage-policy User-Agent must ride along on every request.
    expect((fetchMock.mock.calls.at(-1)![1] as RequestInit).headers).toMatchObject({
      'User-Agent': expect.stringContaining('beybladex.de'),
    })
  })

  it('serves repeated queries from the Redis cache (single upstream call)', async () => {
    nextPayload = [DE_RESULT]
    await searchAddresses('Marienplatz, München')
    fetchMock.mockClear()
    const again = await searchAddresses('  Marienplatz,  München ')
    expect(again).toHaveLength(1)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns [] when the cluster-wide rate-limit lock is held (politeness over coverage)', async () => {
    await hoisted.redisMock.set('geocode:ratelimit', '1', 'EX', 1, 'NX')
    nextPayload = [DE_RESULT]
    expect(await searchAddresses('Marienplatz, München')).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('treats a non-OK upstream response as "no result"', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Service Unavailable', { status: 503 }))
    expect(await searchAddresses('irgendwas ganz anderes')).toEqual([])
  })
})

describe('geocodeAddress — structured full-address lookup', () => {
  it('returns null without a city and never fetches', async () => {
    expect(await geocodeAddress({ postalCode: '80331', city: '', country: 'DE' })).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends structured params and returns the parsed suggestion', async () => {
    nextPayload = [DE_RESULT]
    const suggestion = await geocodeAddress({ street: 'Marienplatz 1', postalCode: '80331', city: 'München', country: 'DE' })
    expect(suggestion?.lat).toBe(48.1371079)
    expect(suggestion?.state).toBe('Bayern')
    const url = lastFetchedUrl()
    expect(url.searchParams.get('street')).toBe('Marienplatz 1')
    expect(url.searchParams.get('postalcode')).toBe('80331')
    expect(url.searchParams.get('city')).toBe('München')
    expect(url.searchParams.get('countrycodes')).toBe('de')
    expect(url.searchParams.get('limit')).toBe('1')
  })

  it('omits empty street/postalCode params and caches by address parts', async () => {
    nextPayload = [AT_RESULT]
    await geocodeAddress({ city: 'Salzburg', country: 'AT' })
    const url = lastFetchedUrl()
    expect(url.searchParams.has('street')).toBe(false)
    expect(url.searchParams.has('postalcode')).toBe(false)
    fetchMock.mockClear()
    expect(await geocodeAddress({ city: 'Salzburg', country: 'AT' })).not.toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns null when upstream finds nothing', async () => {
    expect(await geocodeAddress({ city: 'Nirgendwo', country: 'CH' })).toBeNull()
  })
})

describe('geocodePostalCode — regression through the shared helper', () => {
  it('still resolves a DACH postal code to a point', async () => {
    nextPayload = [{ lat: '48.137', lon: '11.575' }]
    expect(await geocodePostalCode('DE', '80331')).toEqual({ lat: 48.137, lng: 11.575 })
  })

  it('still rejects malformed postal codes without fetching', async () => {
    expect(await geocodePostalCode('DE', '80 331')).toBeNull()
    expect(await geocodePostalCode('CH', '803311')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still rejects out-of-bbox upstream results', async () => {
    nextPayload = [{ lat: '60.0', lon: '11.0' }]
    expect(await geocodePostalCode('DE', '99999')).toBeNull()
  })
})

describe('normalizeAddressQuery', () => {
  it('lowercases, trims and collapses whitespace', () => {
    expect(normalizeAddressQuery('  Marienplatz,   München ')).toBe('marienplatz, münchen')
  })
})
