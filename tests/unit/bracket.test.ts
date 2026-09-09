// tests/unit/bracket.test.ts
// Phase 5 Part C — single-elimination bracket generation is a pure function: deterministic
// seeding (ascending userId), n−1 total matches for n participants, byes as auto-completed
// round-1 matches (see the bye policy documented in lib/bracket.ts).
import { describe, it, expect } from 'vitest'
import { generateSingleEliminationBracket, type BracketNode } from '@/lib/bracket'

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
