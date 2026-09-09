// tests/unit/price-history.test.ts
// Phase 5 Part B: pure sparkline shaping for the collection item detail's Preisverlauf —
// ordering, coordinate math, and the <2-points / constant-series edge cases.
import { describe, it, expect } from 'vitest'
import { shapeSparkline } from '@/lib/priceHistory'

const d = (iso: string) => new Date(iso)

describe('shapeSparkline', () => {
  it('returns null with fewer than 2 observations (UI hides the sparkline)', () => {
    expect(shapeSparkline([])).toBeNull()
    expect(shapeSparkline([{ price: 9.99, recordedAt: d('2026-01-01') }])).toBeNull()
  })

  it('sorts unsorted observations oldest → newest', () => {
    const shaped = shapeSparkline([
      { price: 30, recordedAt: d('2026-03-01') },
      { price: 10, recordedAt: d('2026-01-01') },
      { price: 20, recordedAt: d('2026-02-01') },
    ])!
    // x coordinates must be strictly ascending in sorted order…
    expect(shaped.vertices.map((v) => v.x)).toEqual([8, 120, 232])
    // …and the cheapest (oldest) point sits at the bottom-right-most y ordering.
    expect(shaped.vertices[0]!.y).toBeGreaterThan(shaped.vertices[2]!.y)
    expect(shaped.min).toBe(10)
    expect(shaped.max).toBe(30)
  })

  it('maps a 2-point series to exact viewBox corners (with padding)', () => {
    const shaped = shapeSparkline(
      [
        { price: 10, recordedAt: d('2026-01-01') },
        { price: 20, recordedAt: d('2026-02-01') },
      ],
      { width: 240, height: 80, pad: 8 },
    )!
    expect(shaped.vertices).toEqual([
      { x: 8, y: 72 }, // min → bottom
      { x: 232, y: 8 }, // max → top
    ])
    expect(shaped.path).toBe('M 8,72 L 232,8')
  })

  it('accepts ISO date strings as well as Date objects', () => {
    const shaped = shapeSparkline([
      { price: 10, recordedAt: '2026-01-01T00:00:00Z' },
      { price: 20, recordedAt: '2026-02-01T00:00:00Z' },
    ])!
    expect(shaped.vertices[0]!.x).toBeLessThan(shaped.vertices[1]!.x)
  })

  it('renders a constant series as a flat mid-height line, not a divide-by-zero', () => {
    const shaped = shapeSparkline(
      [
        { price: 15, recordedAt: d('2026-01-01') },
        { price: 15, recordedAt: d('2026-02-01') },
        { price: 15, recordedAt: d('2026-03-01') },
      ],
      { width: 240, height: 80, pad: 8 },
    )!
    expect(shaped.min).toBe(15)
    expect(shaped.max).toBe(15)
    expect(shaped.vertices.every((v) => v.y === 40)).toBe(true)
    expect(shaped.path).toContain('M 8,40')
  })

  it('does not mutate the caller’s array', () => {
    const input = [
      { price: 30, recordedAt: d('2026-03-01') },
      { price: 10, recordedAt: d('2026-01-01') },
    ]
    const snapshot = [...input]
    shapeSparkline(input)
    expect(input).toEqual(snapshot)
  })
})
