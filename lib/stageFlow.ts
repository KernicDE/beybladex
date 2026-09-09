// lib/stageFlow.ts
// Phase 5 Part C2 — shared DB-side tournament-stage flow helpers, used by the score route and the
// no-show route (both mutate bracket slots / standings and must agree on the exact rules).
// All bracket-shape decisions live in the pure libs (lib/bracket.ts, lib/doubleElimination.ts,
// lib/swiss.ts); this module only persists their results.
import { prisma } from '@/lib/db'
import { winnerPropagation, loserPropagation, winnersRounds } from '@/lib/doubleElimination'
import { computeBuchholz, type SwissPlayer } from '@/lib/swiss'
import type { Match, TournamentStage } from '@prisma/client'

/**
 * Winners bracket rounds R for a stage, derived from the stage's own match rows: the highest
 * round is always 3R−1 (grand final), so R = (maxRound + 1) / 3. Works with byes, since slots
 * (not the raw participant count) determine the bracket shape. Returns null for a Swiss stage
 * (round numbers are unused there).
 */
export function stageWinnersRounds(stage: { format: TournamentStage['format']; matches: Pick<Match, 'round'>[] }): number | null {
  if (stage.format === 'SWISS') return null
  const maxRound = Math.max(0, ...stage.matches.map((m) => m.round))
  return (maxRound + 1) / 3
}

async function writeSlot(stageId: string, round: number, bracketOrder: number, slot: 'player1Id' | 'player2Id', userId: string) {
  await prisma.match.updateMany({
    where: { stageId, round, bracketOrder },
    data: { [slot]: userId },
  })
}

/**
 * STUCK-BYE RULE (double-elimination, documented decision): a losers-bracket match whose sibling
 * feeder can NEVER deliver a player (its feeder match is already COMPLETED and produced no player
 * for this slot — a winners-bracket bye or a dead no-op shell) while this match has exactly one
 * live player auto-completes as a bye for the live player (status COMPLETED, winnerId = live
 * player, same representation as a single-elimination bye) and its win propagates onward. Runs to
 * a fixpoint because one auto-bye can unstick the next LB round. Grand-final matches are never
 * auto-completed — their feeders always deliver real players.
 */
export async function resolveStuckByes(stageId: string, participantsForMapping: number): Promise<void> {
  for (let guard = 0; guard < 64; guard++) {
    const lbMatches = await prisma.match.findMany({
      where: { stageId, bracketSide: 'LOSERS', status: { in: ['PENDING', 'IN_PROGRESS'] } },
    })
    let resolved = false
    for (const m of lbMatches) {
      const live = m.player1Id !== null && m.player2Id === null ? { id: m.player1Id, nullSlot: 'player2Id' as const }
        : m.player2Id !== null && m.player1Id === null ? { id: m.player2Id, nullSlot: 'player1Id' as const }
        : null
      if (!live) continue
      const feeder = slotFeeder(m.round, m.bracketOrder, live.nullSlot, participantsForMapping)
      if (!feeder) continue
      const feederMatch = await prisma.match.findFirst({
        where: { stageId, round: feeder.round, bracketOrder: feeder.bracketOrder },
      })
      // The slot can still fill while its feeder is open; only a COMPLETED feeder proves it never
      // will. Re-read the match so a fixpoint pass never double-resolves a slot filled meanwhile.
      if (!feederMatch || feederMatch.status !== 'COMPLETED') continue
      const current = await prisma.match.findUnique({ where: { id: m.id } })
      if (!current || current.status === 'COMPLETED') continue
      if (live.nullSlot === 'player1Id' ? current.player1Id !== null : current.player2Id !== null) continue
      await prisma.match.update({ where: { id: m.id }, data: { status: 'COMPLETED', winnerId: live.id } })
      const wp = winnerPropagation(m, participantsForMapping)
      if (wp.type === 'slot') await writeSlot(stageId, wp.target.round, wp.target.bracketOrder, wp.target.slot, live.id)
      else if (wp.type === 'grand-final') await writeSlot(stageId, 3 * winnersRounds(participantsForMapping) - 1, 0, wp.slot, live.id)
      resolved = true
    }
    if (!resolved) return
  }
}

/**
 * Reverse mapping: which match feeds the given slot of an elimination match, and does it deliver
 * its winner (LB-internal feeder) or its loser (WB drop-in feeder)? null for slots that are wired
 * structurally at generation time (dead shells) or by the score route (grand-final reset).
 */
export function slotFeeder(
  round: number,
  bracketOrder: number,
  slot: 'player1Id' | 'player2Id',
  participantCount: number
): { round: number; bracketOrder: number } | null {
  const R = winnersRounds(participantCount)
  const j = round - R // losers-bracket sub-round
  if (j === 1) {
    // LB round 1: BOTH slots are fed by WB round-1 losers (adjacent pairing).
    return { round: 1, bracketOrder: 2 * bracketOrder + (slot === 'player1Id' ? 0 : 1) }
  }
  if (j >= 2 && j % 2 === 0) {
    // Drop-in round: player1 = LB continuation (winner of previous LB round, same order),
    // player2 = WB drop-in loser.
    return slot === 'player1Id'
      ? { round: R + j - 1, bracketOrder }
      : { round: j / 2 + 1, bracketOrder }
  }
  if (j >= 3 && j % 2 === 1) {
    // Consolidation round: both slots from the previous LB round via the (i+1)/2 parity rule.
    return { round: R + j - 1, bracketOrder: Math.floor(bracketOrder / 2) }
  }
  // Grand final / reset: fed by winner propagation (WB final, LB final) or the score route
  // (reset) — never by a loser drop-in.
  return null
}

/**
 * Propagate a freshly COMPLETED elimination match: winner into their next slot (which may be the
 * grand final), loser into the losers bracket or elimination, grand-final reset wiring, then the
 * stuck-bye fixpoint. `participantsForMapping` is the stage's slot count (nextPow2 of the pool —
 * any number with the same nextPow2 yields the identical mapping).
 */
export async function propagateEliminationResult(
  match: Pick<Match, 'id' | 'stageId' | 'round' | 'bracketOrder' | 'bracketSide' | 'player1Id' | 'player2Id'>,
  winnerId: string,
  participantsForMapping: number
): Promise<void> {
  const loserId = match.player1Id === winnerId ? match.player2Id : match.player1Id

  const wp = winnerPropagation(match, participantsForMapping)
  if (wp.type === 'slot') await writeSlot(match.stageId, wp.target.round, wp.target.bracketOrder, wp.target.slot, winnerId)
  else if (wp.type === 'grand-final') {
    // WB-final and LB-final winners advance into the GRAND FINAL (round 3R−1, order 0) — not
    // into a round relative to the match just completed.
    const R = winnersRounds(participantsForMapping)
    await writeSlot(match.stageId, 3 * R - 1, 0, wp.slot, winnerId)
  }

  const lp = loserPropagation(match, participantsForMapping)
  if (lp.type === 'slot') {
    if (loserId) await writeSlot(match.stageId, lp.target.round, lp.target.bracketOrder, lp.target.slot, loserId)
  } else if (lp.type === 'eliminated' && loserId) {
    await markEliminated(match.stageId, loserId)
  }

  // Grand-final reset wiring: the reset match is generated PENDING and is either populated (LB
  // champion won the first grand final — the WB champion must be beaten twice) or deleted (WB
  // champion won outright). The reset is the ONE generated node that may never be played.
  const R = winnersRounds(participantsForMapping)
  if (match.round === 3 * R - 1 && match.bracketOrder === 0) {
    if (winnerId === match.player2Id && loserId) {
      await prisma.match.updateMany({
        where: { stageId: match.stageId, round: match.round, bracketOrder: 1 },
        data: { player1Id: loserId, player2Id: winnerId },
      })
    } else {
      await prisma.match.deleteMany({
        where: { stageId: match.stageId, round: match.round, bracketOrder: 1 },
      })
    }
  }

  await resolveStuckByes(match.stageId, participantsForMapping)
}

export async function markEliminated(stageId: string, userId: string): Promise<void> {
  await prisma.stageStanding.updateMany({ where: { stageId, userId }, data: { eliminated: true } })
}

/**
 * Record a completed SWISS match on the stage standings: wins/losses + opponent history for both
 * players, then a buchholz recompute for the whole stage (sum of opponents' current win counts).
 * No bracket-slot propagation exists in Swiss — the next round is re-paired from the standings.
 */
export async function recordSwissResult(
  stageId: string,
  winnerId: string,
  loserId: string | null
): Promise<void> {
  await prisma.stageStanding.updateMany({
    where: { stageId, userId: winnerId },
    data: { wins: { increment: 1 }, ...(loserId ? { opponentIds: { push: loserId } } : {}) },
  })
  if (loserId) {
    await prisma.stageStanding.updateMany({
      where: { stageId, userId: loserId },
      data: { losses: { increment: 1 }, opponentIds: { push: winnerId } },
    })
  }
  const standings = await prisma.stageStanding.findMany({ where: { stageId } })
  const buchholz = computeBuchholz(standings as SwissPlayer[])
  for (const [userId, value] of buchholz) {
    await prisma.stageStanding.updateMany({ where: { stageId, userId }, data: { buchholz: value } })
  }
}
