// tests/unit/geo-radius.test.ts (RC9 issue #33)
// Pure-function tests for the /events postal-code radius filter: the SQL bounding-box
// prefilter (radiusBoundingBox) and the exact haversine pass (isWithinRadiusKm) that decides
// for real, because the box's corners overcover. Edge cases: boundary inclusivity, the
// box-covers-but-radius-rejects corner case, and DACH-realistic city distances.
import { describe, it, expect } from 'vitest'
import { haversineKm, isWithinRadiusKm, radiusBoundingBox, KM_PER_LAT_DEG } from '@/lib/geo'

// Wiesbaden — a realistic DACH filter center (PLZ 65189).
const WIESBADEN = { lat: 50.0782, lng: 8.2398 }

describe('radiusBoundingBox', () => {
  it('spans ±radiusKm north/south via the latitude degree constant', () => {
    const box = radiusBoundingBox(WIESBADEN, 50)
    const latDelta = 50 / KM_PER_LAT_DEG
    expect(box.latMax).toBeCloseTo(WIESBADEN.lat + latDelta, 10)
    expect(box.latMin).toBeCloseTo(WIESBADEN.lat - latDelta, 10)
  })

  it('widens the longitude span at higher latitudes (cosine compression)', () => {
    const north = radiusBoundingBox({ lat: 54, lng: 10 }, 50)
    const south = radiusBoundingBox({ lat: 47, lng: 10 }, 50)
    expect(north.lngMax - north.lngMin).toBeGreaterThan(south.lngMax - south.lngMin)
  })

  it('box corners overcover: a corner can be inside the box yet outside the radius', () => {
    // This is exactly why the SQL prefilter must be followed by the exact haversine pass —
    // a query using ONLY the bounding box would return this point for a 25 km radius.
    const box = radiusBoundingBox(WIESBADEN, 25)
    const corner = { lat: box.latMax, lng: box.lngMax }
    expect(corner.lat).toBeGreaterThan(WIESBADEN.lat)
    expect(corner.lng).toBeGreaterThan(WIESBADEN.lng)
    expect(haversineKm(WIESBADEN, corner)).toBeGreaterThan(25)
    expect(isWithinRadiusKm(WIESBADEN, 25, corner)).toBe(false)
  })

  it('contains every point that is truly within the radius', () => {
    const box = radiusBoundingBox(WIESBADEN, 100)
    // Mainz (~10 km), Frankfurt (~38 km), Koblenz (~54 km) — all inside 100 km.
    for (const city of [
      { lat: 50.0, lng: 8.2711 },    // Mainz
      { lat: 50.1109, lng: 8.6821 }, // Frankfurt
      { lat: 50.3569, lng: 7.589 },  // Koblenz
    ]) {
      expect(city.lat).toBeGreaterThanOrEqual(box.latMin)
      expect(city.lat).toBeLessThanOrEqual(box.latMax)
      expect(city.lng).toBeGreaterThanOrEqual(box.lngMin)
      expect(city.lng).toBeLessThanOrEqual(box.lngMax)
      expect(isWithinRadiusKm(WIESBADEN, 100, city)).toBe(true)
    }
  })
})

describe('isWithinRadiusKm', () => {
  it('uses great-circle distance: Frankfurt in 50 km, out of 25 km', () => {
    const frankfurt = { lat: 50.1109, lng: 8.6821 }
    const d = haversineKm(WIESBADEN, frankfurt)
    expect(d).toBeGreaterThan(28)
    expect(d).toBeLessThan(35)
    expect(isWithinRadiusKm(WIESBADEN, 25, frankfurt)).toBe(false)
    expect(isWithinRadiusKm(WIESBADEN, 50, frankfurt)).toBe(true)
  })

  it('is inclusive on the boundary (distance === radius counts as within)', () => {
    // Take a point at an exact known distance and reuse that distance as the radius.
    const mainz = { lat: 50.0, lng: 8.2711 }
    const exact = haversineKm(WIESBADEN, mainz)
    expect(isWithinRadiusKm(WIESBADEN, exact, mainz)).toBe(true)
  })

  it('zero radius matches only the center itself', () => {
    expect(isWithinRadiusKm(WIESBADEN, 0, WIESBADEN)).toBe(true)
    expect(isWithinRadiusKm(WIESBADEN, 0, { lat: WIESBADEN.lat + 0.0001, lng: WIESBADEN.lng })).toBe(false)
  })

  it('rejects points outside DACH-scale radii', () => {
    // Köln ~130 km (out of 100 km, in 500 km); Zürich ~300 km (out of 100 km, in 500 km).
    const koeln = { lat: 50.9375, lng: 6.9603 }
    const zurich = { lat: 47.3769, lng: 8.5417 }
    expect(isWithinRadiusKm(WIESBADEN, 100, koeln)).toBe(false)
    expect(isWithinRadiusKm(WIESBADEN, 500, koeln)).toBe(true)
    expect(isWithinRadiusKm(WIESBADEN, 100, zurich)).toBe(false)
    expect(isWithinRadiusKm(WIESBADEN, 500, zurich)).toBe(true)
  })
})
