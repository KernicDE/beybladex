// app/api/tournaments/[id]/participants/[userId]/paid/route.ts (Phase 7, item 4)
// Payment tracking. AUTHZ RULE (standing Global-Constraints requirement): organizer-marked
// only, per the spec — no QR/self-service path here (payment confirmation is inherently the
// organizer's/staff's authority, they're the one collecting cash or verifying a transfer).
// Only tournament staff (lib/tournamentJudges.ts's isTournamentStaff) may call this; anyone
// else gets 403. PATCH marks paid (sets paidAt = now, idempotent — a second call is a no-op,
// not an error); DELETE marks unpaid again (paidAt = null, for a correction).
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { isTournamentStaff } from '@/lib/tournamentJudges'

type Ctx = { params: Promise<{ id: string; userId: string }> }

// Explicit `ok` discriminant tag, not a bare `{error} | {participant}` union — TypeScript's
// `in` narrowing on that shape left `loaded.error` typed as `Response | undefined` at every
// call site (same footgun as lib/tournamentJudges.ts-adjacent helpers elsewhere in this
// phase; `ok` as a literal boolean discriminant narrows reliably).
type AuthzResult =
  | { ok: true; participant: NonNullable<Awaited<ReturnType<typeof prisma.tournamentParticipant.findUnique>>> }
  | { ok: false; error: Response }

async function authorizeAndLoadParticipant(id: string, targetUserId: string, callerId: string): Promise<AuthzResult> {
  const tournament = await prisma.tournament.findUnique({ where: { id }, select: { createdById: true } })
  if (!tournament) return { ok: false, error: Response.json({ error: 'not_found' }, { status: 404 }) }
  if (!(await isTournamentStaff(id, callerId, tournament.createdById))) {
    return { ok: false, error: Response.json({ error: 'forbidden' }, { status: 403 }) }
  }
  const participant = await prisma.tournamentParticipant.findUnique({
    where: { tournamentId_userId: { tournamentId: id, userId: targetUserId } },
  })
  if (!participant) return { ok: false, error: Response.json({ error: 'not_found' }, { status: 404 }) }
  return { ok: true, participant }
}

export async function PATCH(_req: Request, { params }: Ctx): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  // [REVIEW-FIX: backend-security #37] payment-desk workflow flips many participants in
  // succession — deliberately high (5/s/user); only bounds a compromised staff session.
  const { allowed } = await rateLimit(`tournament:paid:${session.user.id}`, 300, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })
  const { id, userId } = await params

  const loaded = await authorizeAndLoadParticipant(id, userId, session.user.id)
  if (!loaded.ok) return loaded.error

  const updated = await prisma.tournamentParticipant.update({
    where: { id: loaded.participant.id },
    data: { paidAt: loaded.participant.paidAt ?? new Date() },
  })
  return Response.json({ userId: updated.userId, paidAt: updated.paidAt })
}

export async function DELETE(_req: Request, { params }: Ctx): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  // [REVIEW-FIX: backend-security #37] payment-desk workflow flips many participants in
  // succession — deliberately high (5/s/user); only bounds a compromised staff session.
  const { allowed } = await rateLimit(`tournament:paid:${session.user.id}`, 300, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })
  const { id, userId } = await params

  const loaded = await authorizeAndLoadParticipant(id, userId, session.user.id)
  if (!loaded.ok) return loaded.error

  const updated = await prisma.tournamentParticipant.update({
    where: { id: loaded.participant.id },
    data: { paidAt: null },
  })
  return Response.json({ userId: updated.userId, paidAt: updated.paidAt })
}
