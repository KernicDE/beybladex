// tests/unit/scoring.test.ts (RC4, issue #57)
// Direct unit coverage for lib/scoring.ts — the extracted match-scoring rulebook. These pin
// the point matrix (Ruleset-toggle-dependent), the OWN_FINISH opponent direction, the rerun
// semantics, the monotonic-decrease guard and the finals-aware win threshold, so the rules
// can't silently drift between server arithmetic and tests. No HTTP, no DB.
import { describe, it, expect } from 'vitest'
import { SCORED_EVENTS, RERUN_EVENTS, pointsForEvent, isKnownEventType, applyEvent, isMonotonicDecrease, winThreshold } from '@/lib/scoring'

const RULESET = { outOfBounds2Pts: false, ownFinishPenalty: false }

describe('pointsForEvent (point values live in the Ruleset, never hardcoded in the route)', () => {
  it('the base matrix', () => {
    expect(pointsForEvent('SPIN', RULESET)).toBe(1)
    expect(pointsForEvent('OVER', RULESET)).toBe(2)
    expect(pointsForEvent('BURST', RULESET)).toBe(2)
    expect(pointsForEvent('OVERFINISH', RULESET)).toBe(2)
    expect(pointsForEvent('XTREME', RULESET)).toBe(3)
    expect(pointsForEvent('OUT_OF_BOUNDS', RULESET)).toBe(1)
    expect(pointsForEvent('OWN_FINISH', RULESET)).toBe(0)
    expect(pointsForEvent('EXTERNAL_DISTURBANCE', RULESET)).toBe(0)
    expect(pointsForEvent('BOGUS', RULESET)).toBe(0)
  })

  it('Ruleset toggles flip OUT_OF_BOUNDS and OWN_FINISH', () => {
    expect(pointsForEvent('OUT_OF_BOUNDS', { ...RULESET, outOfBounds2Pts: true })).toBe(2)
    expect(pointsForEvent('OWN_FINISH', { ...RULESET, ownFinishPenalty: true })).toBe(1)
  })

  it('SCORED_EVENTS / RERUN_EVENTS partition the event vocabulary', () => {
    expect(SCORED_EVENTS.size).toBe(7)
    expect(RERUN_EVENTS).toEqual(['EXTERNAL_DISTURBANCE', 'AERIAL_CONTACT'])
  })
})

describe('isKnownEventType (preserves the historical acceptance set: rerun triggers are accepted regardless of toggle VALUES)', () => {
  it('accepts every scored and rerun event, rejects unknown types', () => {
    for (const t of [...SCORED_EVENTS, ...RERUN_EVENTS]) expect(isKnownEventType(t)).toBe(true)
    expect(isKnownEventType('SPIN_FINISH')).toBe(false)
    expect(isKnownEventType('')).toBe(false)
  })
})

describe('applyEvent (server-authoritative arithmetic)', () => {
  it('awards points to the scoring player', () => {
    expect(applyEvent(0, 0, { type: 'SPIN', player: 1 }, RULESET)).toEqual({ scorePlayer1: 1, scorePlayer2: 0, rematch: false })
    expect(applyEvent(1, 0, { type: 'XTREME', player: 2 }, RULESET)).toEqual({ scorePlayer1: 1, scorePlayer2: 3, rematch: false })
  })

  it('OUT_OF_BOUNDS reads the ruleset toggle at application time', () => {
    expect(applyEvent(0, 0, { type: 'OUT_OF_BOUNDS', player: 1 }, RULESET).scorePlayer1).toBe(1)
    expect(applyEvent(0, 0, { type: 'OUT_OF_BOUNDS', player: 1 }, { outOfBounds2Pts: true, ownFinishPenalty: false }).scorePlayer1).toBe(2)
  })

  it('OWN_FINISH is a penalty committed BY player — the OPPONENT receives the point', () => {
    expect(applyEvent(2, 2, { type: 'OWN_FINISH', player: 1 }, { outOfBounds2Pts: false, ownFinishPenalty: true }))
      .toEqual({ scorePlayer1: 2, scorePlayer2: 3, rematch: false })
    expect(applyEvent(2, 2, { type: 'OWN_FINISH', player: 2 }, { outOfBounds2Pts: false, ownFinishPenalty: true }))
      .toEqual({ scorePlayer1: 3, scorePlayer2: 2, rematch: false })
  })

  it('rerun triggers change nothing but set the rematch flag', () => {
    expect(applyEvent(3, 1, { type: 'EXTERNAL_DISTURBANCE', player: 1 }, RULESET)).toEqual({ scorePlayer1: 3, scorePlayer2: 1, rematch: true })
    expect(applyEvent(3, 1, { type: 'AERIAL_CONTACT', player: 2 }, RULESET)).toEqual({ scorePlayer1: 3, scorePlayer2: 1, rematch: true })
  })
})

describe('isMonotonicDecrease (full-state stores may only stay or decrease)', () => {
  it('allows stay/decrease, rejects any increase', () => {
    expect(isMonotonicDecrease(2, 2, 2, 2)).toBe(true)
    expect(isMonotonicDecrease(1, 0, 2, 1)).toBe(true)
    expect(isMonotonicDecrease(3, 0, 2, 0)).toBe(false)
    expect(isMonotonicDecrease(0, 3, 0, 2)).toBe(false)
  })
})

describe('winThreshold (finals-aware, stage-format-aware)', () => {
  const rs = { targetPoints: 3, finalsTargetPoints: 5 }

  it('last round of an elimination stage scores at finalsTargetPoints', () => {
    expect(winThreshold('SINGLE_ELIMINATION', 2, 2, rs)).toBe(5)
    expect(winThreshold('DOUBLE_ELIMINATION', 5, 5, rs)).toBe(5)
    expect(winThreshold('SINGLE_ELIMINATION', 1, 2, rs)).toBe(3)
  })

  it('SWISS and ROUND_ROBIN never use finalsTargetPoints (no single final match)', () => {
    expect(winThreshold('SWISS', 3, 5, rs)).toBe(3)
    expect(winThreshold('ROUND_ROBIN', 5, 5, rs)).toBe(3)
  })

  it('a non-positive round (Swiss placeholder rows use round 0) never counts as a final', () => {
    expect(winThreshold('SINGLE_ELIMINATION', 0, 2, rs)).toBe(3)
  })
})
