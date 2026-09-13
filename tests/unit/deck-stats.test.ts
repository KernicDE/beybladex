// tests/unit/deck-stats.test.ts (MVP4/4, #144)
// aggregateDeckStats: Deck-Aggregat über die Auto-Meta-Stats seiner Builds — Summen für
// appearances/wins/losses, winRate erst ab MIN_APPEARANCES (gleiche Denominator-Policy wie
// lib/meta.ts), null-Stats (Build ohne Cache-Eintrag) zählen als 0.
import { describe, it, expect } from 'vitest'
import { aggregateDeckStats } from '@/lib/deckStats'
import { MIN_APPEARANCES, type BuildMetaStats } from '@/lib/meta'

function stats(appearances: number, wins: number): BuildMetaStats {
  return { id: 'b', appearances, wins, losses: appearances - wins, winRate: null }
}

describe('aggregateDeckStats (#144)', () => {
  it('sums appearances, wins and losses across the deck builds', () => {
    const agg = aggregateDeckStats([stats(10, 6), stats(20, 10), stats(5, 5)])
    expect(agg.appearances).toBe(35)
    expect(agg.wins).toBe(21)
    expect(agg.losses).toBe(14)
  })

  it('treats null stats (uncached build) as zero', () => {
    const agg = aggregateDeckStats([stats(10, 6), null, undefined])
    expect(agg.appearances).toBe(10)
    expect(agg.wins).toBe(6)
  })

  it(`computes winRate only from ${MIN_APPEARANCES}+ decisive appearances`, () => {
    expect(aggregateDeckStats([stats(MIN_APPEARANCES - 1, 5)]).winRate).toBeNull()
    const agg = aggregateDeckStats([stats(MIN_APPEARANCES, 6)])
    expect(agg.winRate).toBe(0.6)
  })

  it('rounds winRate to 3 decimals like lib/meta.ts', () => {
    // 6/13 = 0.461538… → 0.462
    const agg = aggregateDeckStats([{ id: 'b', appearances: 13, wins: 6, losses: 7, winRate: null }])
    expect(agg.winRate).toBe(0.462)
  })

  it('aggregates an empty deck to zero stats', () => {
    const agg = aggregateDeckStats([])
    expect(agg).toEqual({ id: 'deck', appearances: 0, wins: 0, losses: 0, winRate: null })
  })
})
