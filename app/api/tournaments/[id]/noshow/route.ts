// app/api/tournaments/[id]/noshow/route.ts
// Phase 5 Part C — no-show handling from the organizer console. AUTHZ RULE (standing
// Global-Constraints requirement): only the tournament's creator or an ADMIN may mark a
// participant withdrawn; anyone else gets 403. Effects: the participant is excluded from
// future bracket generation (withdrawn=true); if the bracket already exists, every pending or
// in-progress Match slot they occupy is resolved in favour of the opponent (auto-advance) —
// the opponent's win is propagated into the next round's slot exactly like a played match, and
// chains of withdrawn players leave an empty (null) slot to be re-seeded rather than inventing
// a winner.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

type Ctx = { params: Promise<{ id: string }> }

async function propagateWinner(tournamentId: string, round: number, bracketOrder: number, winnerId: string | null) {
  if (round < 1 || winnerId === null) return
  const slot = bracketOrder % 2 === 0 ? 'player1Id' : 'player2Id'
  await prisma.match.updateMany({
    where: { tournamentId, round: round + 1, bracketOrder: Math.floor(bracketOrder / 2) },
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
      await propagateWinner(id, m.round, m.bracketOrder, opponent)
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
