// tests/unit/doubleElimination.test.ts
// Phase 5 Part C2 — double-elimination TOPOLOGY, verified round-by-round by hand (the plan calls
// this the highest-risk-of-a-subtle-bug part of the whole task: a node-COUNT check would not
// catch a wrong drop-in mapping, so every assertion below pins exact rounds/orders/slots).
//
// Hand-verified reference topology (see lib/doubleElimination.ts's worked example):
//   4 players (R=2): WB r1: (1,0) p1vp2, (1,1) p3vp4; WB r2 (2,0) final. LB (3,0) ← losers of
//     both WB r1 matches; (4,0) ← winner(3,0) vs WB-final loser; GF (5,0) + reset (5,1).
//   8 players (R=3): WB r1 4 matches, r2 2, r3 final. LB r4 2 matches ← WB r1 losers; r5 2
//     matches ← winners(r4) + WB r2 losers; r6 1 match ← winners(r5); r7 1 match ← winner(r6) +
//     WB-final loser; GF r8 (8,0) + reset (8,1).
import { describe, it, expect } from 'vitest'
import {
  generateDoubleEliminationBracket,
  winnerPropagation,
  loserPropagation,
  type SlotTarget,
} from '@/lib/doubleElimination'
import type { BracketNode } from '@/lib/bracket'

function participants(n: number, prefix = 'p'): { userId: string }[] {
  // Reverse order on purpose: seeding must sort deterministically, not use input order.
  return Array.from({ length: n }, (_, i) => ({ userId: `${prefix}${String(n - i).padStart(3, '0')}` }))
}

function at(nodes: BracketNode[], round: number, order: number): BracketNode {
  const node = nodes.find((m) => m.round === round && m.bracketOrder === order)
  expect(node, `node (${round},${order})`).toBeDefined()
  return node!
}

describe('generateDoubleEliminationBracket — 4 participants, hand-verified topology', () => {
  const bracket = generateDoubleEliminationBracket(participants(4))!

  it('winners bracket is identical to single-elimination (2 semis + final)', () => {
    expect(bracket.winners).toHaveLength(3)
    expect(at(bracket.winners, 1, 0)).toMatchObject({ player1Id: 'p001', player2Id: 'p002', status: 'PENDING' })
    expect(at(bracket.winners, 1, 1)).toMatchObject({ player1Id: 'p003', player2Id: 'p004', status: 'PENDING' })
    expect(at(bracket.winners, 2, 0)).toMatchObject({ player1Id: null, player2Id: null, status: 'PENDING' })
  })

  it('losers bracket has 2R−2 = 2 rounds: LB r3 ← WB-r1 losers, LB r4 ← LB-r3 winner + WB-final loser', () => {
    expect(bracket.losers).toHaveLength(2)
    expect(at(bracket.losers, 3, 0)).toMatchObject({ round: 3, bracketOrder: 0, player1Id: null, player2Id: null, status: 'PENDING' })
    expect(at(bracket.losers, 4, 0)).toMatchObject({ round: 4, bracketOrder: 0, player1Id: null, player2Id: null, status: 'PENDING' })
  })

  it('grand final at round 3R−1 = 5 with a PENDING reset at the same round, order 1', () => {
    expect(bracket.grandFinal).toMatchObject({ round: 5, bracketOrder: 0, player1Id: null, player2Id: null, status: 'PENDING' })
    expect(bracket.grandFinalReset).toMatchObject({ round: 5, bracketOrder: 1, player1Id: null, player2Id: null, status: 'PENDING' })
  })

  it('winner propagation: WB rounds advance within the WB; WB-final winner → GF player1; LB-final winner → GF player2; GF/reset → none', () => {
    expect(winnerPropagation({ round: 1, bracketOrder: 0 }, 4)).toEqual({ type: 'slot', target: { round: 2, bracketOrder: 0, slot: 'player1Id' } })
    expect(winnerPropagation({ round: 1, bracketOrder: 1 }, 4)).toEqual({ type: 'slot', target: { round: 2, bracketOrder: 0, slot: 'player2Id' } })
    expect(winnerPropagation({ round: 2, bracketOrder: 0 }, 4)).toEqual({ type: 'grand-final', slot: 'player1Id' })
    expect(winnerPropagation({ round: 3, bracketOrder: 0 }, 4)).toEqual({ type: 'slot', target: { round: 4, bracketOrder: 0, slot: 'player1Id' } })
    expect(winnerPropagation({ round: 4, bracketOrder: 0 }, 4)).toEqual({ type: 'grand-final', slot: 'player2Id' })
    expect(winnerPropagation({ round: 5, bracketOrder: 0 }, 4)).toEqual({ type: 'none' })
    expect(winnerPropagation({ round: 5, bracketOrder: 1 }, 4)).toEqual({ type: 'none' })
  })

  it('loser propagation: WB-r1 losers → LB r3 (paired adjacently), WB-final loser → LB r4 player2, LB losers + reset loser eliminated, GF loser not eliminated', () => {
    expect(loserPropagation({ round: 1, bracketOrder: 0 }, 4)).toEqual({ type: 'slot', target: { round: 3, bracketOrder: 0, slot: 'player1Id' } })
    expect(loserPropagation({ round: 1, bracketOrder: 1 }, 4)).toEqual({ type: 'slot', target: { round: 3, bracketOrder: 0, slot: 'player2Id' } })
    expect(loserPropagation({ round: 2, bracketOrder: 0 }, 4)).toEqual({ type: 'slot', target: { round: 4, bracketOrder: 0, slot: 'player2Id' } })
    expect(loserPropagation({ round: 3, bracketOrder: 0 }, 4)).toEqual({ type: 'eliminated' })
    expect(loserPropagation({ round: 4, bracketOrder: 0 }, 4)).toEqual({ type: 'eliminated' })
    expect(loserPropagation({ round: 5, bracketOrder: 0 }, 4)).toEqual({ type: 'not-eliminated' })
    expect(loserPropagation({ round: 5, bracketOrder: 1 }, 4)).toEqual({ type: 'eliminated' })
  })
})

describe('generateDoubleEliminationBracket — 8 participants, hand-verified topology', () => {
  const bracket = generateDoubleEliminationBracket(participants(8))!

  it('winners bracket: 7 nodes in 3 rounds, round 1 seeded p001..p008 in adjacent pairs', () => {
    expect(bracket.winners).toHaveLength(7)
    expect(at(bracket.winners, 1, 0)).toMatchObject({ player1Id: 'p001', player2Id: 'p002' })
    expect(at(bracket.winners, 1, 1)).toMatchObject({ player1Id: 'p003', player2Id: 'p004' })
    expect(at(bracket.winners, 1, 2)).toMatchObject({ player1Id: 'p005', player2Id: 'p006' })
    expect(at(bracket.winners, 1, 3)).toMatchObject({ player1Id: 'p007', player2Id: 'p008' })
    expect(bracket.winners.filter((m) => m.round === 2)).toHaveLength(2)
    expect(bracket.winners.filter((m) => m.round === 3)).toHaveLength(1)
  })

  it('losers bracket: 2R−2 = 4 rounds with sizes 2, 2, 1, 1 at rounds R+1..3R−2', () => {
    expect(bracket.losers).toHaveLength(6)
    expect(bracket.losers.filter((m) => m.round === 4)).toHaveLength(2) // j=1: WB-r1 losers
    expect(bracket.losers.filter((m) => m.round === 5)).toHaveLength(2) // j=2: + WB-r2 losers
    expect(bracket.losers.filter((m) => m.round === 6)).toHaveLength(1) // j=3: consolidation
    expect(bracket.losers.filter((m) => m.round === 7)).toHaveLength(1) // j=4: + WB-final loser
  })

  it('grand final + reset at round 3R−1 = 8', () => {
    expect(bracket.grandFinal).toMatchObject({ round: 8, bracketOrder: 0, status: 'PENDING' })
    expect(bracket.grandFinalReset).toMatchObject({ round: 8, bracketOrder: 1, status: 'PENDING' })
  })

  it('winner propagation across the whole 8-player bracket', () => {
    // WB: single-elimination rule.
    expect(winnerPropagation({ round: 1, bracketOrder: 2 }, 8)).toEqual({ type: 'slot', target: { round: 2, bracketOrder: 1, slot: 'player1Id' } })
    expect(winnerPropagation({ round: 2, bracketOrder: 1 }, 8)).toEqual({ type: 'slot', target: { round: 3, bracketOrder: 0, slot: 'player2Id' } })
    expect(winnerPropagation({ round: 3, bracketOrder: 0 }, 8)).toEqual({ type: 'grand-final', slot: 'player1Id' })
    // LB: same-size transition (j odd → drop-in round) keeps the order, player1 slot.
    expect(winnerPropagation({ round: 4, bracketOrder: 1 }, 8)).toEqual({ type: 'slot', target: { round: 5, bracketOrder: 1, slot: 'player1Id' } })
    // LB: halving transition (j even → consolidation) uses the (i+1)/2 parity rule.
    expect(winnerPropagation({ round: 5, bracketOrder: 0 }, 8)).toEqual({ type: 'slot', target: { round: 6, bracketOrder: 0, slot: 'player1Id' } })
    expect(winnerPropagation({ round: 5, bracketOrder: 1 }, 8)).toEqual({ type: 'slot', target: { round: 6, bracketOrder: 0, slot: 'player2Id' } })
    // LB final winner → GF player2.
    expect(winnerPropagation({ round: 7, bracketOrder: 0 }, 8)).toEqual({ type: 'grand-final', slot: 'player2Id' })
    expect(winnerPropagation({ round: 8, bracketOrder: 0 }, 8)).toEqual({ type: 'none' })
    expect(winnerPropagation({ round: 8, bracketOrder: 1 }, 8)).toEqual({ type: 'none' })
  })

  it('loser propagation: WB-r1 → LB r4 paired adjacently; WB r2 → LB r5 same order player2; WB final → LB r7 player2; every LB loss eliminates', () => {
    const t = (round: number, order: number, slot: SlotTarget['slot']): { type: 'slot'; target: SlotTarget } => ({ type: 'slot', target: { round, bracketOrder: order, slot } })
    expect(loserPropagation({ round: 1, bracketOrder: 0 }, 8)).toEqual(t(4, 0, 'player1Id'))
    expect(loserPropagation({ round: 1, bracketOrder: 1 }, 8)).toEqual(t(4, 0, 'player2Id'))
    expect(loserPropagation({ round: 1, bracketOrder: 2 }, 8)).toEqual(t(4, 1, 'player1Id'))
    expect(loserPropagation({ round: 1, bracketOrder: 3 }, 8)).toEqual(t(4, 1, 'player2Id'))
    expect(loserPropagation({ round: 2, bracketOrder: 0 }, 8)).toEqual(t(5, 0, 'player2Id'))
    expect(loserPropagation({ round: 2, bracketOrder: 1 }, 8)).toEqual(t(5, 1, 'player2Id'))
    expect(loserPropagation({ round: 3, bracketOrder: 0 }, 8)).toEqual(t(7, 0, 'player2Id'))
    for (const round of [4, 5, 6, 7]) {
      expect(loserPropagation({ round, bracketOrder: 0 }, 8)).toEqual({ type: 'eliminated' })
    }
    expect(loserPropagation({ round: 8, bracketOrder: 0 }, 8)).toEqual({ type: 'not-eliminated' })
    expect(loserPropagation({ round: 8, bracketOrder: 1 }, 8)).toEqual({ type: 'eliminated' })
  })
})

describe('generateDoubleEliminationBracket — byes (6 participants → 8 slots)', () => {
  const bracket = generateDoubleEliminationBracket(participants(6))!

  it('winners bracket carries the single-elimination byes verbatim (p001, p002 auto-completed)', () => {
    expect(bracket.winners).toHaveLength(7)
    expect(at(bracket.winners, 1, 0)).toMatchObject({ player1Id: 'p001', player2Id: null, winnerId: 'p001', status: 'COMPLETED' })
    expect(at(bracket.winners, 1, 1)).toMatchObject({ player1Id: 'p002', player2Id: null, winnerId: 'p002', status: 'COMPLETED' })
    expect(at(bracket.winners, 1, 2)).toMatchObject({ player1Id: 'p003', player2Id: 'p004', status: 'PENDING' })
    expect(at(bracket.winners, 1, 3)).toMatchObject({ player1Id: 'p005', player2Id: 'p006', status: 'PENDING' })
  })

  it('LB round-1 match fed by two byes is a COMPLETED dead shell; the match fed by real players stays PENDING', () => {
    expect(at(bracket.losers, 4, 0)).toMatchObject({ player1Id: null, player2Id: null, winnerId: null, status: 'COMPLETED' })
    expect(at(bracket.losers, 4, 1)).toMatchObject({ player1Id: null, player2Id: null, winnerId: null, status: 'PENDING' })
  })

  it('grand final structure is unchanged by byes', () => {
    expect(bracket.grandFinal).toMatchObject({ round: 8, bracketOrder: 0, status: 'PENDING' })
    expect(bracket.grandFinalReset).toMatchObject({ round: 8, bracketOrder: 1, status: 'PENDING' })
  })
})

describe('generateDoubleEliminationBracket — general properties', () => {
  it('is deterministic regardless of input order', () => {
    const forward = participants(8)
    const reversed = [...forward].reverse()
    expect(generateDoubleEliminationBracket(forward)).toEqual(generateDoubleEliminationBracket(reversed))
  })

  it('total nodes = (slots−1) WB + (slots−2) LB+GF for a full power of 2 (8 → 7 + 6 + 2 = 15 = 2n−1)', () => {
    const bracket = generateDoubleEliminationBracket(participants(8))!
    expect(bracket.winners.length + bracket.losers.length + 2).toBe(15)
  })

  it('returns null below 3 participants', () => {
    expect(generateDoubleEliminationBracket(participants(2))).toBeNull()
    expect(generateDoubleEliminationBracket([])).toBeNull()
  })
})
