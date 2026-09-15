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

/**
 * Bracket-placement ranking for an elimination stage — champion first, then every other pool
 * member ordered by the round of their LAST loss (deepest run first), userId tiebreak for
 * determinism. Extracted here (issue #199 placement persistence) from
 * app/api/tournaments/[id]/stages/[stageId]/complete/route.ts, which already computed this
 * exact ranking to decide `qualifiedUserIds` — single source of truth now, reused by
 * lib/tournamentPlacement.ts for the whole-tournament placement snapshot written at
 * tournament completion. `lbRounds` virtualizes a double-elimination WINNERS-bracket loss to
 * rank below every LOSERS-bracket loss (a WB loss is a lesser run than surviving into the LB).
 */
export function eliminationRanking(
  matches: { id: string; round: number; bracketOrder: number; bracketSide: string | null; player1Id: string | null; player2Id: string | null; winnerId: string | null; status: string }[],
  pool: string[]
): string[] {
  const played = matches.filter((m) => m.status === 'COMPLETED' && m.winnerId !== null && m.player1Id !== null && m.player2Id !== null)
  const championMatch = [...played].sort((a, b) => b.round - a.round || b.bracketOrder - a.bracketOrder)[0]
  const champion = championMatch?.winnerId ?? null
  const maxRound = Math.max(0, ...matches.map((m) => m.round))
  const lbRounds = maxRound > 0 && matches.some((m) => m.bracketSide === 'GRAND_FINAL') ? 2 * ((maxRound + 1) / 3) - 2 : 0

  // Issue #199 bug fix: the championship match's LOSER (the runner-up) must be recorded here
  // too — skipping the championship match entirely (the previous behavior) silently dropped the
  // runner-up's placement, ranking them BELOW every semifinal loser instead of 2nd. The champion
  // never appears as a `loser` below (by construction they won every match that decided the
  // title), so there is no risk of this loop ever recording a placement entry for them — pool
  // filters them out separately anyway.
  const placement = new Map<string, number>()
  for (const m of played) {
    const loser = m.player1Id === m.winnerId ? m.player2Id! : m.player1Id!
    const virtualRound = m.round + (m.bracketSide === 'WINNERS' ? lbRounds : 0)
    // A player's placement is their LAST (deepest-round) loss; winning the whole stage never
    // lands here (the champion never loses the match that decides the title).
    placement.set(loser, Math.max(placement.get(loser) ?? 0, virtualRound))
  }

  return [
    ...(champion ? [champion] : []),
    ...pool
      .filter((u) => u !== champion)
      .sort((a, b) => (placement.get(b) ?? 0) - (placement.get(a) ?? 0) || (a < b ? -1 : a > b ? 1 : 0)),
  ]
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
        // Issue #181 — "Veranstalter kann die Decks einsehen" (OrganizerConsole).
        include: { user: { select: { id: true, username: true, displayName: true } }, deck: { select: { id: true, title: true } } },
      },
      // RC15 #12 — team-mode registrations and encounters (slots + users resolve sub-game
      // players; the bracket renders TeamMatch rows instead of solo matches).
      teamEntries: {
        orderBy: { createdAt: 'asc' },
        include: {
          team: { select: { id: true, name: true, slug: true } },
          slots: {
            orderBy: { position: 'asc' },
            include: {
              user: { select: { id: true, username: true, displayName: true } },
              deck: { include: { builds: { orderBy: { position: 'asc' }, include: { build: { include: { blade: true, lockChip: true, overBlade: true, metalBlade: true, assistBlade: true, ratchet: true, bit: true } } } } } },
            },
          },
        },
      },
      stages: {
        orderBy: { order: 'asc' },
        include: {
          matches: {
            orderBy: [{ round: 'asc' }, { bracketOrder: 'asc' }],
            include: {
              judge: { select: { id: true, username: true, displayName: true } },
              player1Build: { include: { blade: true, lockChip: true, overBlade: true, metalBlade: true, assistBlade: true, ratchet: true, bit: true } },
              player2Build: { include: { blade: true, lockChip: true, overBlade: true, metalBlade: true, assistBlade: true, ratchet: true, bit: true } },
            },
          },
          teamMatches: {
            orderBy: [{ round: 'asc' }, { bracketOrder: 'asc' }],
            include: {
              team1Entry: { select: { id: true, team: { select: { name: true } } } },
              team2Entry: { select: { id: true, team: { select: { name: true } } } },
              games: {
                orderBy: { bracketOrder: 'asc' },
                include: { judge: { select: { id: true, username: true, displayName: true } } },
              },
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
