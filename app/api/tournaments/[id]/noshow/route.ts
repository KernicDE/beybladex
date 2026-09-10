// app/api/tournaments/[id]/noshow/route.ts
// Phase 5 Part C — no-show handling from the organizer console; Phase 5 Part C2 — format-aware.
// AUTHZ RULE (standing Global-Constraints requirement): only the tournament's creator or an
// ADMIN may mark a participant withdrawn; anyone else gets 403. Effects: the participant is
// excluded from future bracket/pairing generation (withdrawn=true); every pending or in-progress
// Match slot they occupy is resolved in favour of the opponent (auto-advance), and the win is
// propagated exactly like a played match. Chains of withdrawn players leave an empty (null) slot
// to be re-seeded rather than inventing a winner.
//
// Phase 5 Part C2 additions, per format:
//   SWISS / ROUND_ROBIN — the withdrawn player's remaining matches become OPPONENT WINS
//     (completed with the opponent as winner, recorded on both players' StageStanding rows)
//     instead of silently vanishing; future Swiss pairings already exclude withdrawn players.
//   DOUBLE_ELIMINATION — the withdrawn participant is ELIMINATED (StageStanding.eliminated = true,
//     not merely skipped). Their opponent's win propagates per the bracket mapping; the withdrawn
//     player's own loser-drop does NOT happen (they are out, not dropped into the losers bracket),
//     and the now-unfillable LB slots downstream resolve via the stuck-bye rule (lib/stageFlow.ts).
//   SINGLE_ELIMINATION — unchanged Part C behavior, now stage-scoped.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { assignFreedArena } from '@/lib/arenaAssign'
import { winnerPropagation } from '@/lib/doubleElimination'
import { markEliminated, recordSwissResult, resolveStuckByes } from '@/lib/stageFlow'

type Ctx = { params: Promise<{ id: string }> }

async function propagateWinner(stageId: string, round: number, bracketOrder: number, winnerId: string | null) {
  if (round < 1 || winnerId === null) return
  const slot = bracketOrder % 2 === 0 ? 'player1Id' : 'player2Id'
  await prisma.match.updateMany({
    where: { stageId, round: round + 1, bracketOrder: Math.floor(bracketOrder / 2) },
    data: { [slot]: winnerId },
  })
}

export async function POST(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const userId = typeof body.userId === 'string' ? body.userId : ''
  if (!userId) return Response.json({ error: 'invalid_user' }, { status: 400 })

  const tournament = await prisma.tournament.findUnique({ where: { id }, select: { createdById: true } })
  if (!tournament) return Response.json({ error: 'not_found' }, { status: 404 })
  const caller = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
  if (tournament.createdById !== session.user.id && caller?.role !== 'ADMIN') {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  const participant = await prisma.tournamentParticipant.findUnique({
    where: { tournamentId_userId: { tournamentId: id, userId } },
  })
  if (!participant) return Response.json({ error: 'not_found' }, { status: 404 })
  if (participant.withdrawn) return Response.json({ error: 'already_withdrawn' }, { status: 409 })

  await prisma.tournamentParticipant.update({ where: { id: participant.id }, data: { withdrawn: true } })

  // Stage formats/R values for every stage that has open matches (a no-show resolves per stage).
  const stages = await prisma.tournamentStage.findMany({
    where: { tournamentId: id },
    include: { matches: { select: { round: true } } },
  })
  const stageById = new Map(stages.map((s) => [s.id, s]))
  const rFor = (stageId: string): number => {
    const s = stageById.get(stageId)
    if (!s || s.format !== 'DOUBLE_ELIMINATION') return 0
    return (Math.max(0, ...s.matches.map((m) => m.round)) + 1) / 3
  }
  // Double-elimination: a withdrawn player is OUT of the stage entirely.
  for (const s of stages) {
    if (s.format === 'DOUBLE_ELIMINATION') await markEliminated(s.id, userId)
  }

  // Auto-advance: resolve every open match slot the withdrawn player occupies.
  const open = await prisma.match.findMany({
    where: {
      tournamentId: id,
      status: { in: ['PENDING', 'IN_PROGRESS'] },
      OR: [{ player1Id: userId }, { player2Id: userId }],
    },
  })
  const advanced: string[] = []
  for (const m of open) {
    const stage = stageById.get(m.stageId)
    const isP1 = m.player1Id === userId
    const opponent = isP1 ? m.player2Id : m.player1Id
    const opponentWithdrawn = opponent
      ? !!(await prisma.tournamentParticipant.findUnique({
          where: { tournamentId_userId: { tournamentId: id, userId: opponent } },
          select: { withdrawn: true },
        }))?.withdrawn
      : false
    if (opponent && !opponentWithdrawn) {
      await prisma.match.update({
        where: { id: m.id },
        data: { winnerId: opponent, status: 'COMPLETED', [isP1 ? 'player1Id' : 'player2Id']: opponent },
      })
      // Phase 7 — an auto-completed match frees its arena like a played one (no-op without one).
      await assignFreedArena(m)
      if (stage?.format === 'SWISS' || stage?.format === 'ROUND_ROBIN') {
        // The opponent wins on the standings (recordSwissResult is the shared standings-ranked
        // formats' helper — Swiss pairing and Round Robin both); the withdrawn player takes the
        // loss + opponent history, so their record reflects the matches they missed.
        await recordSwissResult(m.stageId, opponent, userId)
      } else if (stage?.format === 'DOUBLE_ELIMINATION') {
        // Opponent advances per the bracket mapping; the withdrawn player's own loser-drop is
        // skipped (they are eliminated, not dropped). The stuck-bye rule then resolves any LB
        // match left unplayable by the missing drop-in.
        const wp = winnerPropagation(m, 2 ** rFor(m.stageId))
        if (wp.type === 'slot') {
          await prisma.match.updateMany({
            where: { stageId: m.stageId, round: wp.target.round, bracketOrder: wp.target.bracketOrder },
            data: { [wp.target.slot]: opponent },
          })
        } else if (wp.type === 'grand-final') {
          await prisma.match.updateMany({
            where: { stageId: m.stageId, round: Math.max(0, ...((stage?.matches.map((x) => x.round)) ?? [0])), bracketOrder: 0 },
            data: { [wp.slot]: opponent },
          })
        }
        await resolveStuckByes(m.stageId, 2 ** rFor(m.stageId))
      } else {
        await propagateWinner(m.stageId, m.round, m.bracketOrder, opponent)
      }
      advanced.push(m.id)
    } else {
      // No live opponent (bye-slot or withdrawn opponent): clear the dead slot, no winner.
      await prisma.match.update({
        where: { id: m.id },
        data: { [isP1 ? 'player1Id' : 'player2Id']: null },
      })
    }
  }

  return Response.json({ withdrawn: true, advancedMatches: advanced })
}
