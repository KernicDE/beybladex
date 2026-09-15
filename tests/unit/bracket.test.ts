// tests/unit/bracket.test.ts
// Phase 5 Part C — single-elimination bracket generation is a pure function: deterministic
// seeding (ascending userId), n−1 total matches for n participants, byes as auto-completed
// round-1 matches (see the bye policy documented in lib/bracket.ts).
import { describe, it, expect } from 'vitest'
import { generateSingleEliminationBracket, nextSingleEliminationSlot, stageWinnersRounds, eliminationRanking, type BracketNode } from '@/lib/bracket'

function participants(n: number, prefix = 'p'): { userId: string }[] {
  // Reverse order on purpose: the generator must sort deterministically, not use input order.
  return Array.from({ length: n }, (_, i) => ({ userId: `${prefix}${String(n - i).padStart(3, '0')}` }))
}

function byRound(nodes: BracketNode[], round: number): BracketNode[] {
  return nodes.filter((m) => m.round === round).sort((a, b) => a.bracketOrder - b.bracketOrder)
}

describe('generateSingleEliminationBracket', () => {
  it('generates 3 matches in 2 rounds for 4 participants, first-round pairings sorted by userId', () => {
    const nodes = generateSingleEliminationBracket(participants(4))
    expect(nodes).toHaveLength(3)
    expect(byRound(nodes, 1)).toHaveLength(2)
    expect(byRound(nodes, 2)).toHaveLength(1)

    const r1 = byRound(nodes, 1)
    expect(r1[0]).toMatchObject({ player1Id: 'p001', player2Id: 'p002', status: 'PENDING', winnerId: null })
    expect(r1[1]).toMatchObject({ player1Id: 'p003', player2Id: 'p004', status: 'PENDING', winnerId: null })
    // Semifinal winners feed the final's two slots; the final starts empty.
    expect(byRound(nodes, 2)[0]).toMatchObject({ player1Id: null, player2Id: null, status: 'PENDING' })
  })

  it('generates 7 matches in 3 rounds for 8 participants', () => {
    const nodes = generateSingleEliminationBracket(participants(8))
    expect(nodes).toHaveLength(7)
    expect(byRound(nodes, 1)).toHaveLength(4)
    expect(byRound(nodes, 2)).toHaveLength(2)
    expect(byRound(nodes, 3)).toHaveLength(1)
  })

  it('generates 15 matches in 4 rounds for 16 participants', () => {
    const nodes = generateSingleEliminationBracket(participants(16))
    expect(nodes).toHaveLength(15)
    expect(byRound(nodes, 1)).toHaveLength(8)
    expect(byRound(nodes, 4)).toHaveLength(1)
  })

  it('handles a non-power-of-2 count (6 → 8 slots): byes go to the lowest-seeded IDs as auto-completed round-1 matches', () => {
    const nodes = generateSingleEliminationBracket(participants(6))
    expect(nodes).toHaveLength(7) // always n−1
    const r1 = byRound(nodes, 1)
    expect(r1).toHaveLength(4)
    // 2 byes → matches 0 and 1 are single-player, COMPLETED, winner = the bye recipient.
    expect(r1[0]).toMatchObject({ player1Id: 'p001', player2Id: null, winnerId: 'p001', status: 'COMPLETED' })
    expect(r1[1]).toMatchObject({ player1Id: 'p002', player2Id: null, winnerId: 'p002', status: 'COMPLETED' })
    // The remaining 4 players fill the other two round-1 matches.
    expect(r1[2]).toMatchObject({ player1Id: 'p003', player2Id: 'p004', status: 'PENDING' })
    expect(r1[3]).toMatchObject({ player1Id: 'p005', player2Id: 'p006', status: 'PENDING' })
    expect(byRound(nodes, 2)).toHaveLength(2)
    expect(byRound(nodes, 3)).toHaveLength(1)
  })

  it('is deterministic regardless of input order', () => {
    const forward = participants(8)
    const reversed = [...forward].reverse()
    expect(generateSingleEliminationBracket(forward)).toEqual(generateSingleEliminationBracket(reversed))
  })

  it('returns no matches for fewer than 2 participants', () => {
    expect(generateSingleEliminationBracket(participants(1))).toEqual([])
    expect(generateSingleEliminationBracket([])).toEqual([])
  })
})

// RC6 #56 — the per-stage winners-round derivation has exactly one implementation (lib/bracket.ts);
// the old lib/stageFlow.ts copy was dead code AND wrong for single-elimination ((R+1)/3 of a
// maxRound=R stage is not an integer). These pin the GRAND_FINAL-aware behavior for both formats.
describe('stageWinnersRounds', () => {
  it('single-elimination: R is the max round (no GRAND_FINAL side exists)', () => {
    expect(stageWinnersRounds([
      { round: 1, bracketSide: null },
      { round: 1, bracketSide: null },
      { round: 2, bracketSide: null },
    ])).toBe(2)
    expect(stageWinnersRounds([{ round: 1, bracketSide: null }])).toBe(1)
  })

  it('double-elimination: maxRound = 3R−1 and the GRAND_FINAL side flips the formula to (maxRound + 1) / 3', () => {
    const gfOnly = [{ round: 8, bracketSide: 'GRAND_FINAL' as const }]
    expect(stageWinnersRounds(gfOnly)).toBe(3) // R=3: 8 = 3·3−1
    expect(stageWinnersRounds([
      { round: 7, bracketSide: 'LOSERS' },
      { round: 8, bracketSide: 'GRAND_FINAL' },
      { round: 8, bracketSide: 'GRAND_FINAL' }, // reset
    ])).toBe(3)
    expect(stageWinnersRounds([{ round: 5, bracketSide: 'GRAND_FINAL' as const }])).toBe(2) // R=2: 5 = 3·2−1
  })

  it('an empty stage returns 0 (round numbers unused for Swiss/round-robin)', () => {
    expect(stageWinnersRounds([])).toBe(0)
  })
})

// RC6 #35 — single-elimination winner forwarding is pure bracket-shape math (extracted from the
// score route so the progression engine is unit-testable without the route's HTTP/DB stack).
describe('nextSingleEliminationSlot', () => {
  it('adjacent winners fill the two slots of the next-round match (2i, 2i+1) → i', () => {
    expect(nextSingleEliminationSlot({ round: 1, bracketOrder: 0 })).toEqual({ round: 2, bracketOrder: 0, slot: 'player1Id' })
    expect(nextSingleEliminationSlot({ round: 1, bracketOrder: 1 })).toEqual({ round: 2, bracketOrder: 0, slot: 'player2Id' })
    expect(nextSingleEliminationSlot({ round: 2, bracketOrder: 2 })).toEqual({ round: 3, bracketOrder: 1, slot: 'player1Id' })
    expect(nextSingleEliminationSlot({ round: 2, bracketOrder: 3 })).toEqual({ round: 3, bracketOrder: 1, slot: 'player2Id' })
  })
})

// Issue #199 — extracted from the stage-complete route (unchanged behavior) so the whole-
// tournament placement snapshot (lib/tournamentPlacement.ts) can reuse the exact same ranking.
describe('eliminationRanking', () => {
  it('4-player single-elimination: champion first, semifinal losers tied below the runner-up', () => {
    const matches = [
      { id: 'm1', round: 1, bracketOrder: 0, bracketSide: null, player1Id: 'a', player2Id: 'b', winnerId: 'a', status: 'COMPLETED' },
      { id: 'm2', round: 1, bracketOrder: 1, bracketSide: null, player1Id: 'c', player2Id: 'd', winnerId: 'c', status: 'COMPLETED' },
      { id: 'm3', round: 2, bracketOrder: 0, bracketSide: null, player1Id: 'a', player2Id: 'c', winnerId: 'a', status: 'COMPLETED' },
    ]
    const ranking = eliminationRanking(matches, ['a', 'b', 'c', 'd'])
    expect(ranking[0]).toBe('a') // champion
    expect(ranking[1]).toBe('c') // runner-up (lost the final, round 2)
    // b and d both lost in round 1 — tied for 3rd, order between them is the userId tiebreak.
    expect(ranking.slice(2)).toEqual(['b', 'd'])
  })

  it('double-elimination: a run through the losers bracket outranks a single winners-bracket loss', () => {
    // R=2 (4 players): WB rounds 1-2, LB rounds 3-4 (3R-2=4), grand final round 5 (3R-1).
    const matches = [
      { id: 'wb1', round: 1, bracketOrder: 0, bracketSide: 'WINNERS', player1Id: 'a', player2Id: 'b', winnerId: 'a', status: 'COMPLETED' },
      { id: 'wb2', round: 1, bracketOrder: 1, bracketSide: 'WINNERS', player1Id: 'c', player2Id: 'd', winnerId: 'c', status: 'COMPLETED' },
      { id: 'wbf', round: 2, bracketOrder: 0, bracketSide: 'WINNERS', player1Id: 'a', player2Id: 'c', winnerId: 'a', status: 'COMPLETED' },
      { id: 'lb1', round: 3, bracketOrder: 0, bracketSide: 'LOSERS', player1Id: 'b', player2Id: 'd', winnerId: 'd', status: 'COMPLETED' },
      { id: 'lbf', round: 4, bracketOrder: 0, bracketSide: 'LOSERS', player1Id: 'd', player2Id: 'c', winnerId: 'd', status: 'COMPLETED' },
      { id: 'gf', round: 5, bracketOrder: 0, bracketSide: 'GRAND_FINAL', player1Id: 'a', player2Id: 'd', winnerId: 'a', status: 'COMPLETED' },
    ]
    const ranking = eliminationRanking(matches, ['a', 'b', 'c', 'd'])
    // a won it all; d ran the whole losers bracket to the grand final (runner-up); c lost the
    // WB final and was eliminated in the LB final; b lost round 1 and was eliminated in LB
    // round 1 — the least deep run of the four.
    expect(ranking).toEqual(['a', 'd', 'c', 'b'])
  })
})
