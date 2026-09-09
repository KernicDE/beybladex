// lib/bracket.ts
// Phase 5 Part C — single-elimination bracket generation for the organizer console
// ([REVIEW-FIX: performance P6]: the tournament page reads matches + participants in ONE
// findUnique include, never per-match queries; generation itself is a pure function so it is
// unit-testable without a database).
//
// BYE POLICY (documented decision): participants carry no seeding data, so seeding is
// deterministic — ascending userId. The first (nextPow2 − n) participants in that order receive
// a bye. A bye is represented as a round-1 match with player2 = null, status COMPLETED and
// winnerId = the bye recipient, so bracket rendering and advancement propagation stay uniform
// (the winner slot feeds the next round exactly like a played match).
import { prisma } from '@/lib/db'
import type { MatchStatus, TournamentParticipant } from '@prisma/client'

export type BracketNode = {
  round: number
  bracketOrder: number
  player1Id: string | null
  player2Id: string | null
  winnerId: string | null
  status: MatchStatus
}

export function generateSingleEliminationBracket(participants: Pick<TournamentParticipant, 'userId'>[]): BracketNode[] {
  const sorted = [...participants].sort((a, b) => (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0))
  const count = sorted.length
  if (count < 2) return []

  let slots = 1
  while (slots < count) slots *= 2
  const rounds = Math.log2(slots)
  const byes = slots - count
  const firstRoundMatches = slots / 2
  const nodes: BracketNode[] = []

  for (let i = 0; i < firstRoundMatches; i++) {
    if (i < byes) {
      // Bye: single-player, auto-completed round-1 match (see bye policy above).
      const player = sorted[i].userId
      nodes.push({ round: 1, bracketOrder: i, player1Id: player, player2Id: null, winnerId: player, status: 'COMPLETED' })
    } else {
      const k = byes + 2 * (i - byes)
      nodes.push({
        round: 1,
        bracketOrder: i,
        player1Id: sorted[k].userId,
        player2Id: sorted[k + 1].userId,
        winnerId: null,
        status: 'PENDING',
      })
    }
  }

  // Later rounds: empty slots filled by winners of (2i, 2i+1) of the previous round.
  let matchesInRound = firstRoundMatches / 2
  for (let round = 2; round <= rounds; round++) {
    for (let i = 0; i < matchesInRound; i++) {
      nodes.push({ round, bracketOrder: i, player1Id: null, player2Id: null, winnerId: null, status: 'PENDING' })
    }
    matchesInRound /= 2
  }
  return nodes
}

// One-query bracket loader for the tournament/judge pages: matches and participants in a single
// findUnique — do not replace this with per-match lookups ([REVIEW-FIX: performance P6]).
export async function loadTournamentBracket(tournamentId: string) {
  return prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      ruleset: true,
      participants: {
        orderBy: { id: 'asc' },
        include: { user: { select: { id: true, username: true, displayName: true } } },
      },
      matches: {
        orderBy: [{ round: 'asc' }, { bracketOrder: 'asc' }],
        include: {
          judge: { select: { id: true, username: true, displayName: true } },
          player1Build: { include: { blade: true, ratchet: true, bit: true } },
          player2Build: { include: { blade: true, ratchet: true, bit: true } },
        },
      },
    },
  })
}
