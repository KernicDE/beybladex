// app/api/tournaments/[id]/stages/[stageId]/complete/route.ts
// Phase 5 Part C2 — "Stage abschließen" from the organizer console. AUTHZ RULE (standing
// Global-Constraints requirement; negative test in tests/integration/stage-authz.test.ts): only
// the tournament's creator (createdById) or an ADMIN may complete a stage; anyone else gets 403.
//
// Refuses (409) unless: every match in the stage is COMPLETED, AND (SWISS) swissRoundsDone ==
// swissRounds. Then computes the stage's FINAL RANKING:
//   • SWISS — the StageStanding order (wins desc, buchholz desc, userId asc).
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
import { sortSwiss } from '@/lib/swiss'

type Ctx = { params: Promise<{ id: string; stageId: string }> }

export async function POST(_req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id, stageId } = await params

  const stage = await prisma.tournamentStage.findUnique({
    where: { id: stageId },
    include: { tournament: { select: { createdById: true } } },
  })
  if (!stage || stage.tournamentId !== id) return Response.json({ error: 'not_found' }, { status: 404 })
  const caller = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
  if (stage.tournament.createdById !== session.user.id && caller?.role !== 'ADMIN') {
    return Response.json({ error: 'forbidden' }, { status: 403 })
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
  if (stage.format === 'SWISS') {
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
  return Response.json({ id: stageId, status: 'COMPLETED', ranking, qualified: qualified.length > 0 ? qualified : undefined })
}

/**
 * Bracket-placement ranking for an elimination stage (see header). `lbRounds` = 2R−2 for
 * double-elimination (a WB loss is virtualized to round + lbRounds), 0 for single-elimination.
 */
function eliminationRanking(
  matches: { id: string; round: number; bracketOrder: number; bracketSide: string | null; player1Id: string | null; player2Id: string | null; winnerId: string | null; status: string }[],
  pool: string[]
): string[] {
  const played = matches.filter((m) => m.status === 'COMPLETED' && m.winnerId !== null && m.player1Id !== null && m.player2Id !== null)
  const championMatch = [...played].sort((a, b) => b.round - a.round || b.bracketOrder - a.bracketOrder)[0]
  const champion = championMatch?.winnerId ?? null
  const maxRound = Math.max(0, ...matches.map((m) => m.round))
  const lbRounds = maxRound > 0 && matches.some((m) => m.bracketSide === 'GRAND_FINAL') ? 2 * ((maxRound + 1) / 3) - 2 : 0

  const placement = new Map<string, number>()
  for (const m of played) {
    if (m.winnerId === champion && m.id === championMatch?.id) continue
    const loser = m.player1Id === m.winnerId ? m.player2Id! : m.player1Id!
    const virtualRound = m.round + (m.bracketSide === 'WINNERS' ? lbRounds : 0)
    // A player's placement is their LAST (deepest-round) loss; winning the whole stage never
    // lands here (champion excluded above).
    placement.set(loser, Math.max(placement.get(loser) ?? 0, virtualRound))
  }

  return [
    ...(champion ? [champion] : []),
    ...pool
      .filter((u) => u !== champion)
      .sort((a, b) => (placement.get(b) ?? 0) - (placement.get(a) ?? 0) || (a < b ? -1 : a > b ? 1 : 0)),
  ]
}
