// tests/unit/bracket-seeding.test.ts (Phase 15)
import { describe, it, expect } from 'vitest'
import { sortBySeed, assignSeedsToUnseeded, rankUnseededByRating, shuffleOrder } from '@/lib/seeding'
import { generateSingleEliminationBracket } from '@/lib/bracket'
import { generateRoundRobinPairings } from '@/lib/roundRobin'

describe('sortBySeed', () => {
  it('honors manual seeds exactly, ascending', () => {
    const participants = [
      { userId: 'c', seed: 3 },
      { userId: 'a', seed: 1 },
      { userId: 'b', seed: 2 },
    ]
    expect(sortBySeed(participants).map((p) => p.userId)).toEqual(['a', 'b', 'c'])
  })

  it('places every seeded participant before every unseeded one', () => {
    const participants = [
      { userId: 'z', seed: null },
      { userId: 'y', seed: 5 },
      { userId: 'x', seed: null },
    ]
    expect(sortBySeed(participants).map((p) => p.userId)).toEqual(['y', 'x', 'z'])
  })

  it('falls back to ascending userId when every seed is null (byte-for-byte pre-Phase-15 behavior)', () => {
    const participants = [{ userId: 'zeta' }, { userId: 'alpha' }, { userId: 'mid' }]
    expect(sortBySeed(participants).map((p) => p.userId)).toEqual(['alpha', 'mid', 'zeta'])
  })
})

describe('assignSeedsToUnseeded', () => {
  it('leaves manually-seeded participants untouched and assigns consecutive seeds after the max manual seed', () => {
    const participants = [
      { userId: 'top1', seed: 1 },
      { userId: 'top2', seed: 2 },
      { userId: 'rest1', seed: null },
      { userId: 'rest2', seed: null },
    ]
    const assignments = assignSeedsToUnseeded(participants, ['rest1', 'rest2'])
    expect(assignments.get('rest1')).toBe(3)
    expect(assignments.get('rest2')).toBe(4)
    expect(assignments.has('top1')).toBe(false)
    expect(assignments.has('top2')).toBe(false)
  })

  it('starts at seed 1 when nobody has a manual seed yet', () => {
    const participants = [{ userId: 'a', seed: null }, { userId: 'b', seed: null }]
    const assignments = assignSeedsToUnseeded(participants, ['b', 'a'])
    expect(assignments.get('b')).toBe(1)
    expect(assignments.get('a')).toBe(2)
  })
})

describe('rankUnseededByRating', () => {
  it('sorts rated participants by elo descending', () => {
    const eloByUserId = new Map([['low', 900], ['high', 1400], ['mid', 1100]])
    expect(rankUnseededByRating(['low', 'high', 'mid'], eloByUserId)).toEqual(['high', 'mid', 'low'])
  })

  it('places an unranked participant after every rated one, deterministically by userId among unranked ties', () => {
    const eloByUserId = new Map([['rated', 1000]])
    expect(rankUnseededByRating(['zeta-unranked', 'rated', 'alpha-unranked'], eloByUserId)).toEqual([
      'rated',
      'alpha-unranked',
      'zeta-unranked',
    ])
  })
})

describe('shuffleOrder', () => {
  it('is always a valid permutation of the input (never asserted for a specific order)', () => {
    const input = ['a', 'b', 'c', 'd', 'e']
    const shuffled = shuffleOrder(input)
    expect(shuffled).toHaveLength(input.length)
    expect([...shuffled].sort()).toEqual([...input].sort())
  })
})

describe('regression: zero-seed-set case is unchanged for every format', () => {
  it('generateSingleEliminationBracket with no seeds matches the old ascending-userId bracket', () => {
    const participants = [{ userId: 'p3' }, { userId: 'p1' }, { userId: 'p2' }, { userId: 'p4' }]
    const nodes = generateSingleEliminationBracket(participants)
    const round1 = nodes.filter((n) => n.round === 1)
    expect(round1[0]).toMatchObject({ player1Id: 'p1', player2Id: 'p2' })
    expect(round1[1]).toMatchObject({ player1Id: 'p3', player2Id: 'p4' })
  })

  it('generateRoundRobinPairings with no seeds matches the old ascending-userId pivot', () => {
    const participants = [{ userId: 'p3' }, { userId: 'p1' }, { userId: 'p2' }]
    const pairings = generateRoundRobinPairings(participants, 1)
    // p1 (lowest userId) is the fixed pivot and sits out round 1 as the bye (odd field of 3);
    // the round-1 match is the other two, p2 vs p3 — matching the circle method's
    // pre-Phase-15 deterministic output.
    expect(pairings[0]).toEqual({ round: 1, player1Id: 'p2', player2Id: 'p3' })
  })
})
