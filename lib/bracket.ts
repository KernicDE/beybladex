// lib/bracket.ts
// Phase 5 Part C — single-elimination bracket generation for the organizer console
// ([REVIEW-FIX: performance P6]: the tournament page reads matches + participants in ONE
// findUnique include, never per-match queries; generation itself is a pure function so it is
// unit-testable without a database).
//
// SEEDING (Phase 15 — replaces the old "no seeding data" policy): participants are sorted by
// lib/seeding.ts's sortBySeed (TournamentParticipant.seed ascending, unseeded last, userId
// tie-break — byte-for-byte the old behavior when every seed is null). The first
// (nextPow2 − n) participants IN THAT ORDER receive a bye — i.e. the top seeds get the byes,
// matching standard seeded-bracket convention (a "no-seed" field still degrades gracefully:
// with everyone unseeded, this is just the old userId-ascending bye assignment). A bye is
// represented as a round-1 match with player2 = null, status COMPLETED and winnerId = the bye
// recipient, so bracket rendering and advancement propagation stay uniform (the winner slot
// feeds the next round exactly like a played match).
import { prisma } from '@/lib/db'
import type { Match, MatchStatus, TournamentParticipant } from '@prisma/client'
import { sortBySeed } from '@/lib/seeding'

export type BracketNode = {
  round: number
  bracketOrder: number
  player1Id: string | null
  player2Id: string | null
  winnerId: string | null
  status: MatchStatus
}

export function generateSingleEliminationBracket(participants: (Pick<TournamentParticipant, 'userId'> & { seed?: number | null })[]): BracketNode[] {
  const sorted = sortBySeed(participants)
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

/**
 * Per-stage winners-bracket round count R (RC6 #56 — single source of truth, moved here from the
 * two page-local copies and the dead/faulty lib/stageFlow.ts copy): double-elimination's grand
 * final sits at round 3R−1, so a stage with a GRAND_FINAL match derives R = (maxRound + 1) / 3;
 * every other format (single-elimination maxRound = R, Swiss/round-robin round numbers unused)
 * derives R = maxRound. Empty stages (no matches yet) return 0.
 */
export function stageWinnersRounds(matches: { round: number; bracketSide: Match['bracketSide'] | null }[]): number {
  const maxRound = Math.max(0, ...matches.map((m) => m.round))
  if (maxRound === 0) return 0
  return matches.some((m) => m.bracketSide === 'GRAND_FINAL') ? (maxRound + 1) / 3 : maxRound
}

/** Next-round slot target for an elimination match winner (the (2i, 2i+1) → i pairing). */
export type NextSlotTarget = { round: number; bracketOrder: number; slot: 'player1Id' | 'player2Id' }

/**
 * Where a SINGLE-ELIMINATION match winner advances (RC6 #35 — extracted from the score route so
 * the progression rule lives with the other pure bracket-shape decisions and is unit-testable):
 * winners of adjacent matches (2i, 2i+1) fill slots player1/player2 of next-round match i.
 */
export function nextSingleEliminationSlot(match: { round: number; bracketOrder: number }): NextSlotTarget {
  return {
    round: match.round + 1,
    bracketOrder: Math.floor(match.bracketOrder / 2),
    slot: match.bracketOrder % 2 === 0 ? 'player1Id' : 'player2Id',
  }
}

// One-query bracket loader for the tournament/judge pages: matches and participants in a single
// findUnique — do not replace this with per-match lookups ([REVIEW-FIX: performance P6]).
// Phase 5 Part C2: matches live on STAGES (each with its own format + standings), loaded in the
// same single query.
export async function loadTournamentBracket(tournamentId: string) {
  return prisma.tournament.findUnique({
    where: { id: tournamentId },
    include: {
      ruleset: true,
      participants: {
        orderBy: { id: 'asc' },
        include: { user: { select: { id: true, username: true, displayName: true } } },
      },
      stages: {
        orderBy: { order: 'asc' },
        include: {
          matches: {
            orderBy: [{ round: 'asc' }, { bracketOrder: 'asc' }],
            include: {
              judge: { select: { id: true, username: true, displayName: true } },
              player1Build: { include: { blade: true, ratchet: true, bit: true } },
              player2Build: { include: { blade: true, ratchet: true, bit: true } },
            },
          },
          standings: {
            orderBy: [{ wins: 'desc' }, { buchholz: 'desc' }, { userId: 'asc' }],
            include: { user: { select: { id: true, username: true, displayName: true } } },
          },
        },
      },
    },
  })
}
