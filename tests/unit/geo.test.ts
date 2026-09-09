// tests/unit/geo.test.ts
// Phase 3: haversineKm accuracy — the plan's acceptance criterion demands ≤0.5% error
// against known city-pair distances, written as literal assertions.
import { describe, it, expect } from 'vitest'
import { haversineKm } from '@/lib/geo'

describe('haversineKm', () => {
  it('Zürich–Bern ≈ 95 km (within 0.5%)', () => {
    const d = haversineKm({ lat: 47.3769, lng: 8.5417 }, { lat: 46.948, lng: 7.4474 })
    expect(d).toBeGreaterThan(95.5 * 0.995)
    expect(d).toBeLessThan(95.5 * 1.005)
  })

  it('Berlin–München ≈ 504 km (within 0.5%)', () => {
    const d = haversineKm({ lat: 52.52, lng: 13.405 }, { lat: 48.1372, lng: 11.5755 })
    expect(d).toBeGreaterThan(504.3 * 0.995)
    expect(d).toBeLessThan(504.3 * 1.005)
  })

  it('Wien–Graz ≈ 144.6 km (within 0.5%)', () => {
    const d = haversineKm({ lat: 48.2082, lng: 16.3738 }, { lat: 47.0707, lng: 15.4395 })
    expect(d).toBeGreaterThan(144.6 * 0.995)
    expect(d).toBeLessThan(144.6 * 1.005)
  })

  it('distance is symmetric and zero for identical points', () => {
    const a = { lat: 47.3769, lng: 8.5417 }
    const b = { lat: 53.5511, lng: 9.9937 }
    expect(haversineKm(a, a)).toBe(0)
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 10)
  })

  // Note: the plan text also mentions "Zürich–Wohlen ≈ 25.6 km" as an example — that figure
  // is the ROAD distance. The Zürich–Wohlen AG great-circle distance is ≈ 20.2 km, which is
  // what haversineKm must (and does) return; a 25.6 km assertion would be wrong for any
  // great-circle formula, so the three assertions above are the literal accuracy proof.
})
