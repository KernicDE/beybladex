// app/api/tournaments/[id]/checkin/route.ts
// Day-of check-in. AUTHZ RULE (standing Global-Constraints requirement — both paths tested in
// tests/integration/tournament-join-flow.test.ts): PATCH sets TournamentParticipant.checkedIn =
// true, callable by (a) the participant themselves (self-check-in via the "Jetzt einchecken"
// button on /events/[id]) or (b) the tournament's organizer (createdById) or a user with the
// ADMIN role (the day-of check-in table). Anyone else gets 403; non-participants get 404.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  let body: unknown = {}
  try {
    body = await req.json()
  } catch {
    // body is optional — self-check-in needs no fields
  }
  const targetUserId = (body as Record<string, unknown>).userId
  // An organizer checking someone in targets that participant via body.userId; a self-check-in
  // leaves it unset and checks in the caller.
  const participantUserId =
    typeof targetUserId === 'string' && targetUserId.length > 0 ? targetUserId : session.user.id

  const tournament = await prisma.tournament.findUnique({ where: { id }, select: { createdById: true } })
  if (!tournament) return Response.json({ error: 'not_found' }, { status: 404 })

  const participant = await prisma.tournamentParticipant.findUnique({
    where: { tournamentId_userId: { tournamentId: id, userId: participantUserId } },
  })
  if (!participant) return Response.json({ error: 'not_found' }, { status: 404 })

  const isSelf = participantUserId === session.user.id
  if (!isSelf) {
    const caller = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
    if (tournament.createdById !== session.user.id && caller?.role !== 'ADMIN') {
      return Response.json({ error: 'forbidden' }, { status: 403 })
    }
  }

  const updated = await prisma.tournamentParticipant.update({
    where: { id: participant.id },
    data: { checkedIn: true },
  })
  return Response.json({ id: updated.id, userId: updated.userId, checkedIn: updated.checkedIn })
}
