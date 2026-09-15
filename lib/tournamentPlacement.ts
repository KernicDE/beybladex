// lib/tournamentPlacement.ts (issue #199)
// Computes and persists a tournament's FINAL placement per participant, once, at tournament
// completion (called from app/api/tournaments/[id]/complete/route.ts). Reuses the exact same
// per-stage rankings the organizer console already computes when a stage completes
// (lib/swiss.ts's sortSwiss, lib/bracket.ts's eliminationRanking) — no new ranking logic, just
// a stage-to-stage chain: the LAST stage's finishers get placements 1..k, then the previous
// stage's finishers who did NOT qualify into the last stage continue k+1.., and so on backward
// through the tournament. A multi-stage tournament (e.g. Swiss group stage → single-elimination
// playoffs) places "made playoffs and lost round 1" above "didn't make playoffs at all" —
// exactly the intuitive notion of "how far did you get."
//
// Team-mode tournaments use entry ids in place of user ids throughout (same substitution the
// stage-complete route already makes) and write TeamTournamentEntry has no placement column
// (issue #199's Team-Elo/ranking work reads TeamMatch results directly instead, see
// lib/teamStats.ts) — this module only persists SOLO TournamentParticipant.placement.
import { prisma } from '@/lib/db'
import { sortSwiss } from '@/lib/swiss'
import { eliminationRanking } from '@/lib/bracket'

async function rankingForStage(stageId: string, format: string, pool: string[]): Promise<string[]> {
  if (format === 'SWISS' || format === 'ROUND_ROBIN') {
    const standings = await prisma.stageStanding.findMany({ where: { stageId } })
    return sortSwiss(standings).map((s) => s.userId)
  }
  const matches = await prisma.match.findMany({ where: { stageId } })
  return eliminationRanking(matches, pool)
}

/**
 * Computes and writes TournamentParticipant.placement for every non-withdrawn participant of a
 * SOLO (non-team-mode) tournament. Idempotent — safe to call again (e.g. a re-completion),
 * always overwrites with a freshly computed ranking. No-op (skips entirely) for a tournament
 * with no completed stages yet (e.g. a STAMMTISCH/FREEPLAY tournament, or one completed before
 * any stage ran) — there is nothing to rank.
 */
export async function computeAndPersistPlacement(tournamentId: string): Promise<void> {
  const [tournament, stages, participants] = await Promise.all([
    prisma.tournament.findUnique({ where: { id: tournamentId }, select: { teamMode: true } }),
    prisma.tournamentStage.findMany({
      where: { tournamentId, status: 'COMPLETED' },
      orderBy: { order: 'desc' },
      select: { id: true, order: true, format: true, qualifiedUserIds: true },
    }),
    prisma.tournamentParticipant.findMany({ where: { tournamentId, withdrawn: false }, select: { userId: true } }),
  ])
  if (!tournament || tournament.teamMode || stages.length === 0) return

  const placement = new Map<string, number>()
  let rank = 1
  for (const stage of stages) {
    // The pool a stage ranks OVER is the previous stage's qualifiers (or, for stage order 1,
    // every tournament participant) — same rule the stage-complete route itself uses. A stage
    // can only ever complete once its predecessor has (generation reads the predecessor's
    // qualifiedUserIds as its own participant pool), so the predecessor is always present in
    // this already-loaded COMPLETED-stages list — no extra query needed.
    const pool = stage.order === 1
      ? participants.map((p) => p.userId)
      : stages.find((s) => s.order === stage.order - 1)?.qualifiedUserIds ?? []
    const ranking = await rankingForStage(stage.id, stage.format, pool)
    for (const userId of ranking) {
      if (placement.has(userId)) continue // already placed by a LATER stage they reached
      placement.set(userId, rank++)
    }
  }
  // Participants who never appear in any completed stage's ranking (withdrew before playing,
  // or joined after the pool was fixed) go last, in a stable but otherwise arbitrary order.
  for (const p of participants) {
    if (!placement.has(p.userId)) placement.set(p.userId, rank++)
  }

  if (placement.size === 0) return
  await prisma.$transaction(
    [...placement.entries()].map(([userId, place]) =>
      prisma.tournamentParticipant.update({
        where: { tournamentId_userId: { tournamentId, userId } },
        data: { placement: place },
      }),
    ),
  )
}
