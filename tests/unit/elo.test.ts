// tests/unit/elo.test.ts (Phase 14)
// Table-driven, exact expected values (not a tolerance-band assertion) per the plan's own
// acceptance criteria — hand-computed against the standard logistic Elo formula.
import { describe, it, expect } from 'vitest'
import { kFactor, expectedScore, applyEloResult, regressToMean, MIN_RATED_GAMES_FOR_LADDER } from '@/lib/elo'

describe('kFactor', () => {
  it('is 40 for a player with fewer than 30 rated games so far', () => {
    expect(kFactor(0)).toBe(40)
    expect(kFactor(29)).toBe(40)
  })
  it('is 20 from the 30th rated game onward', () => {
    expect(kFactor(30)).toBe(20)
    expect(kFactor(500)).toBe(20)
  })
})

describe('expectedScore', () => {
  it('is 0.5 for two equally-rated players', () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5, 10)
  })
  it('favors the higher-rated player', () => {
    // 1200 vs 1000: expected = 1 / (1 + 10^(-200/400)) = 1 / (1 + 10^-0.5) ≈ 0.7597469...
    expect(expectedScore(1200, 1000)).toBeCloseTo(0.7597469, 6)
    expect(expectedScore(1000, 1200)).toBeCloseTo(0.2402531, 6)
  })
})

describe('applyEloResult', () => {
  it('provisional tier (K=40): equal-rated win gains exactly 20', () => {
    // eloSelf=1000, eloOpp=1000, expected=0.5, K=40 → newElo = 1000 + 40*(1-0.5) = 1020
    const result = applyEloResult(1000, 1000, 1, 0)
    expect(result.newElo).toBe(1020)
    expect(result.delta).toBe(20)
  })
  it('provisional tier (K=40): equal-rated loss loses exactly 20', () => {
    const result = applyEloResult(1000, 1000, 0, 0)
    expect(result.newElo).toBe(980)
    expect(result.delta).toBe(-20)
  })
  it('established tier (K=20): equal-rated win gains exactly 10', () => {
    const result = applyEloResult(1000, 1000, 1, 30)
    expect(result.newElo).toBe(1010)
    expect(result.delta).toBe(10)
  })
  it('established tier (K=20): equal-rated loss loses exactly 10', () => {
    const result = applyEloResult(1000, 1000, 0, 30)
    expect(result.newElo).toBe(990)
    expect(result.delta).toBe(-10)
  })
  it('an upset (lower-rated beats higher-rated) gains more than an expected win', () => {
    // eloSelf=1000, eloOpp=1200, expected=0.2402531, K=40 → 1000 + 40*(1-0.2402531) = 1030.39 → round 1030
    const upset = applyEloResult(1000, 1200, 1, 0)
    expect(upset.newElo).toBe(1030)
    // eloSelf=1000, eloOpp=800, expected=0.7597469, K=40 → 1000 + 40*(1-0.7597469) = 1009.6 → round 1010
    const expectedWin = applyEloResult(1000, 800, 1, 0)
    expect(expectedWin.newElo).toBe(1010)
    expect(upset.delta).toBeGreaterThan(expectedWin.delta)
  })
})

describe('regressToMean', () => {
  it('pulls a high rating 25% of the way back toward 1000', () => {
    // 1400 * 0.75 + 1000 * 0.25 = 1050 + 250 = 1300
    expect(regressToMean(1400)).toBe(1300)
  })
  it('pulls a low rating 25% of the way back toward 1000', () => {
    // 600 * 0.75 + 1000 * 0.25 = 450 + 250 = 700
    expect(regressToMean(600)).toBe(700)
  })
  it('leaves an already-baseline rating unchanged', () => {
    expect(regressToMean(1000)).toBe(1000)
  })
})

describe('MIN_RATED_GAMES_FOR_LADDER', () => {
  it('is 5, per the plan', () => {
    expect(MIN_RATED_GAMES_FOR_LADDER).toBe(5)
  })
})
