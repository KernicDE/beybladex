// app/api/tournaments/[id]/participants/[userId]/paid/route.ts (Phase 7, item 4)
// Payment tracking. AUTHZ RULE (standing Global-Constraints requirement): organizer-marked
// only, per the spec — no QR/self-service path here (payment confirmation is inherently the
// organizer's/staff's authority, they're the one collecting cash or verifying a transfer).
// Only tournament staff (lib/tournamentJudges.ts's isTournamentStaff) may call this; anyone
// else gets 403. PATCH marks paid (sets paidAt = now, idempotent — a second call is a no-op,
// not an error); DELETE marks unpaid again (paidAt = null, for a correction).
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { isTournamentStaff } from '@/lib/tournamentJudges'

type Ctx = { params: Promise<{ id: string; userId: string }> }

async function authorizeAndLoadParticipant(id: string, targetUserId: string, callerId: string) {
  const tournament = await prisma.tournament.findUnique({ where: { id }, select: { createdById: true } })
  if (!tournament) return { error: Response.json({ error: 'not_found' }, { status: 404 }) } as const
  if (!(await isTournamentStaff(id, callerId, tournament.createdById))) {
    return { error: Response.json({ error: 'forbidden' }, { status: 403 }) } as const
  }
  const participant = await prisma.tournamentParticipant.findUnique({
    where: { tournamentId_userId: { tournamentId: id, userId: targetUserId } },
  })
  if (!participant) return { error: Response.json({ error: 'not_found' }, { status: 404 }) } as const
  return { participant } as const
}

export async function PATCH(_req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id, userId } = await params

  const loaded = await authorizeAndLoadParticipant(id, userId, session.user.id)
  if ('error' in loaded) return loaded.error

  const updated = await prisma.tournamentParticipant.update({
    where: { id: loaded.participant.id },
    data: { paidAt: loaded.participant.paidAt ?? new Date() },
  })
  return Response.json({ userId: updated.userId, paidAt: updated.paidAt })
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id, userId } = await params

  const loaded = await authorizeAndLoadParticipant(id, userId, session.user.id)
  if ('error' in loaded) return loaded.error

  const updated = await prisma.tournamentParticipant.update({
    where: { id: loaded.participant.id },
    data: { paidAt: null },
  })
  return Response.json({ userId: updated.userId, paidAt: updated.paidAt })
}
