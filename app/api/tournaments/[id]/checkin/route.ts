// app/api/tournaments/[id]/checkin/route.ts
// Day-of check-in. AUTHZ RULE (standing Global-Constraints requirement — both paths tested in
// tests/integration/tournament-join-flow.test.ts): PATCH sets TournamentParticipant.checkedIn =
// true, callable by (a) the participant themselves — self-check-in via the "Jetzt einchecken"
// button on /events/[id], OR via the Phase 7 QR path (/events/[id]/checkin?t=<token>, the
// logged-in scanner checks THEMSELVES in — see that page) — or (b) tournament staff:
// lib/tournamentJudges.ts's isTournamentStaff (createdById, a global ADMIN, or a
// TournamentJudge row for THIS tournament specifically, not any JUDGE anywhere on the
// platform). Anyone else gets 403; non-participants get 404.
// Phase 7 QR self-service note: `t` (query string or body) is OPTIONAL — the pre-existing
// non-QR "Jetzt einchecken" button sends none and self-check-in proceeds as before; when
// present it MUST match Tournament.checkInToken (a mismatched/stale token is 403 token_mismatch)
// — this is a convenience/venue-scoping check, not an anti-fraud system (documented limitation,
// see the phase spec: a shared photo of the QR could still be scanned remotely by a logged-in
// user; the organizer/staff manual-marking path is the authoritative fallback).
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { isTournamentStaff } from '@/lib/tournamentJudges'

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
  const fields = body as Record<string, unknown>
  const targetUserId = fields.userId
  const tokenFromBody = typeof fields.t === 'string' ? fields.t : null
  const tokenFromQuery = new URL(req.url).searchParams.get('t')
  const token = tokenFromBody ?? tokenFromQuery
  // An organizer/staff checking someone in targets that participant via body.userId; a
  // self-check-in (button or QR) leaves it unset and checks in the caller.
  const participantUserId =
    typeof targetUserId === 'string' && targetUserId.length > 0 ? targetUserId : session.user.id

  const tournament = await prisma.tournament.findUnique({
    where: { id },
    select: { createdById: true, checkInToken: true },
  })
  if (!tournament) return Response.json({ error: 'not_found' }, { status: 404 })
  if (token !== null && token !== tournament.checkInToken) {
    return Response.json({ error: 'token_mismatch' }, { status: 403 })
  }

  const participant = await prisma.tournamentParticipant.findUnique({
    where: { tournamentId_userId: { tournamentId: id, userId: participantUserId } },
  })
  if (!participant) return Response.json({ error: 'not_found' }, { status: 404 })

  const isSelf = participantUserId === session.user.id
  if (!isSelf && !(await isTournamentStaff(id, session.user.id, tournament.createdById))) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  const updated = await prisma.tournamentParticipant.update({
    where: { id: participant.id },
    data: { checkedIn: true },
  })
  return Response.json({ id: updated.id, userId: updated.userId, checkedIn: updated.checkedIn })
}
