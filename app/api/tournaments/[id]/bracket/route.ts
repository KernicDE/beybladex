// app/api/tournaments/[id]/bracket/route.ts
// Phase 5 Part C — "Bracket generieren" from the organizer console. AUTHZ RULE (standing
// Global-Constraints requirement; negative test in tests/integration/organizer-console.test.ts):
// only the tournament's creator (createdById) or a user with the ADMIN role may generate a
// bracket; anyone else gets 403. Generates the single-elimination bracket from the currently
// checked-in, non-withdrawn participants (lib/bracket.ts) and persists ALL rounds as Match
// rows — round 1 with real (or bye) players, later rounds as empty slots that the score route
// fills as predecessors complete. Refuses to double-generate (409 bracket_exists).
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { generateSingleEliminationBracket } from '@/lib/bracket'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const tournament = await prisma.tournament.findUnique({
    where: { id },
    select: { createdById: true, participants: { where: { checkedIn: true, withdrawn: false }, select: { userId: true } } },
  })
  if (!tournament) return Response.json({ error: 'not_found' }, { status: 404 })
  const caller = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
  if (tournament.createdById !== session.user.id && caller?.role !== 'ADMIN') {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  const existing = await prisma.match.count({ where: { tournamentId: id } })
  if (existing > 0) return Response.json({ error: 'bracket_exists' }, { status: 409 })

  const participants = tournament.participants as { userId: string }[]
  if (participants.length < 2) {
    return Response.json({ error: 'not_enough_participants', checkedIn: participants.length }, { status: 422 })
  }

  const nodes = generateSingleEliminationBracket(participants)
  await prisma.match.createMany({
    data: nodes.map((n) => ({
      tournamentId: id,
      round: n.round,
      bracketOrder: n.bracketOrder,
      player1Id: n.player1Id,
      player2Id: n.player2Id,
      winnerId: n.winnerId,
      status: n.status,
    })),
  })

  // Bye winners advance immediately: fill their round-2 slot (same propagation the score route
  // performs for played matches).
  for (const bye of nodes.filter((n) => n.round === 1 && n.winnerId !== null)) {
    const slot = bye.bracketOrder % 2 === 0 ? 'player1Id' : 'player2Id'
    await prisma.match.updateMany({
      where: { tournamentId: id, round: 2, bracketOrder: Math.floor(bye.bracketOrder / 2) },
      data: { [slot]: bye.winnerId },
    })
  }

  return Response.json({ created: nodes.length }, { status: 201 })
}
