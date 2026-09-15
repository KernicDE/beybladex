// app/api/tournaments/[id]/stages/[stageId]/complete/route.ts
// Phase 5 Part C2 — "Stage abschließen" from the organizer console. AUTHZ RULE (standing
// Global-Constraints requirement; negative test in tests/integration/stage-authz.test.ts): only
// the tournament's creator (createdById) or an ADMIN may complete a stage; anyone else gets 403.
//
// Refuses (409) unless: every match in the stage is COMPLETED, AND (SWISS) swissRoundsDone ==
// swissRounds. Then computes the stage's FINAL RANKING:
//   • SWISS / ROUND_ROBIN — the StageStanding order (wins desc, buchholz desc, userId asc);
//     ROUND_ROBIN (Phase 5 Part C3) reuses this rule exactly (its completion gate is the
//     elimination formats' all-matches-COMPLETED rule, not Swiss's round counter).
//   • SINGLE_ELIMINATION / DOUBLE_ELIMINATION — bracket placement: the champion first (winner of
//     the highest-(round, order) COMPLETED match — the grand-final reset when played, else the
//     grand final / final), then every other participant by the round of the match they LAST
//     LOST. A WINNERS-bracket loss counts its round plus the losers-bracket length (2R−2), so the
//     double-elimination grand-final loser (WB runner-up, one loss) ranks above every LB player,
//     who each carry two losses. Ties break by userId for determinism.
// If qualifyCount is set, the top `qualifyCount` userIds are written to the stage's
// qualifiedUserIds — the NEXT stage's generate route reads exactly this list as its participant
// pool (the stage-to-stage qualification gate). Sets TournamentStage.status = COMPLETED.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { sortSwiss } from '@/lib/swiss'
import { eliminationRanking } from '@/lib/bracket'
import { invalidatePublicCache, publicTournamentKey } from '@/lib/publicCache'

type Ctx = { params: Promise<{ id: string; stageId: string }> }

export async function POST(_req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  // [REVIEW-FIX: backend-security #37] organizer stage lifecycle; 30/min/user.
  const { allowed } = await rateLimit(`tournament:stage-complete:${session.user.id}`, 30, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })
  const { id, stageId } = await params

  const stage = await prisma.tournamentStage.findUnique({
    where: { id: stageId },
    include: { tournament: { select: { createdById: true, teamMode: true } } },
  })
  if (!stage || stage.tournamentId !== id) return Response.json({ error: 'not_found' }, { status: 404 })
  const caller = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
  if (stage.tournament.createdById !== session.user.id && caller?.role !== 'ADMIN') {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  // RC15 #12 — team mode: the stage's bracket nodes are TeamMatch encounters; the completion
  // gate and the placement ranking run over them (entry ids in place of user ids — the stage's
  // qualifiedUserIds then carries ENTRY ids forward to the next stage's generate, which looks
  // them up as TeamTournamentEntries).
  if (stage.tournament.teamMode) {
    const teamMatches = await prisma.teamMatch.findMany({ where: { stageId } })
    if (teamMatches.some((m) => m.status !== 'COMPLETED')) {
      return Response.json({ error: 'matches_open' }, { status: 409 })
    }
    const pool = stage.order === 1
      ? (await prisma.teamTournamentEntry.findMany({ where: { tournamentId: id }, select: { id: true } })).map((e) => e.id)
      : ((await prisma.tournamentStage.findUnique({ where: { tournamentId_order: { tournamentId: id, order: stage.order - 1 } } }))?.qualifiedUserIds ?? [])
    const ranking = eliminationRanking(
      teamMatches.map((m) => ({
        id: m.id, round: m.round, bracketOrder: m.bracketOrder, bracketSide: m.bracketSide,
        player1Id: m.team1EntryId, player2Id: m.team2EntryId, winnerId: m.winnerEntryId, status: m.status,
      })),
      pool
    )
    const qualified = stage.qualifyCount !== null ? ranking.slice(0, stage.qualifyCount) : []
    await prisma.tournamentStage.update({
      where: { id: stageId },
      data: { status: 'COMPLETED', qualifiedUserIds: qualified },
    })
    await invalidatePublicCache(publicTournamentKey(id))
    return Response.json({ id: stageId, status: 'COMPLETED', ranking, qualified: qualified.length > 0 ? qualified : undefined })
  }

  const matches = await prisma.match.findMany({ where: { stageId } })
  if (matches.some((m) => m.status !== 'COMPLETED')) {
    return Response.json({ error: 'matches_open' }, { status: 409 })
  }
  if (stage.format === 'SWISS' && stage.swissRoundsDone !== stage.swissRounds) {
    return Response.json({ error: 'swiss_incomplete' }, { status: 409 })
  }

  const pool = stage.order === 1
    ? (await prisma.tournamentParticipant.findMany({ where: { tournamentId: id }, select: { userId: true } })).map((p) => p.userId)
    : ((await prisma.tournamentStage.findUnique({ where: { tournamentId_order: { tournamentId: id, order: stage.order - 1 } } }))?.qualifiedUserIds ?? [])

  let ranking: string[]
  if (stage.format === 'SWISS' || stage.format === 'ROUND_ROBIN') {
    const standings = await prisma.stageStanding.findMany({ where: { stageId } })
    ranking = sortSwiss(standings).map((s) => s.userId)
  } else {
    ranking = eliminationRanking(matches, pool)
  }

  const qualified = stage.qualifyCount !== null ? ranking.slice(0, stage.qualifyCount) : []
  await prisma.tournamentStage.update({
    where: { id: stageId },
    data: { status: 'COMPLETED', qualifiedUserIds: qualified },
  })
  // Hotfix #99: the cached public detail page previews the latest stage's matches/standings.
  await invalidatePublicCache(publicTournamentKey(id))
  return Response.json({ id: stageId, status: 'COMPLETED', ranking, qualified: qualified.length > 0 ? qualified : undefined })
}
