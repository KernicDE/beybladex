// app/api/tournaments/[id]/route.ts
// PATCH — edit a Tournament. AUTHZ RULE (standing Global-Constraints requirement): only the
// owner (createdById, always from the session at create time) or a user with the ADMIN role may
// modify a tournament; everyone else gets 403 (negative test: tests/integration/tournament-ownership.test.ts).
// DELETE — same authz rule; participant rows and matches are removed in the same transaction
// (both FKs to Tournament have no cascade in spec §3, and participants' registrations must not
// block an organizer from cancelling their own event). Stage rows (Phase 5 Part C2) cascade at
// the DB level (onDelete: Cascade on TournamentStage + StageStanding + Match.stageId) but are
// also deleted explicitly here to match this route's explicit-cleanup style.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { parseTournamentInput } from '@/lib/tournamentValidation'
import { authorizeTournamentOrganizer } from '@/lib/tournamentService'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  // [REVIEW-FIX: backend-security #37] organizer edit/cancel of the tournament itself;
  // 30/min/user.
  const { allowed } = await rateLimit(`tournament:edit:${session.user.id}`, 30, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })
  const { id } = await params

  const { error } = await authorizeTournamentOrganizer(id, session.user.id, { id: true, createdById: true })
  if (error) return error

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }

  const { data, errors } = parseTournamentInput(body, true)
  if (errors.length > 0) return Response.json({ error: errors[0], errors }, { status: 400 })

  if (data.rulesetId) {
    const ruleset = await prisma.ruleset.findUnique({ where: { id: data.rulesetId } })
    if (!ruleset) return Response.json({ error: 'invalid_ruleset' }, { status: 400 })
  }
  if (data.endDate) {
    // Compare against the patched startDate if one is given, else the stored one.
    const current = await prisma.tournament.findUnique({ where: { id }, select: { startDate: true } })
    const start = data.startDate ?? current!.startDate
    if (data.endDate < start) return Response.json({ error: 'end_before_start' }, { status: 400 })
  }

  // description is required (non-null) — a JSON null from the client clears it to "". Destructure
  // first so the update payload's type carries `string`, not `string | null` (Prisma rejects null
  // for required columns even in update inputs).
  const { description, ...rest } = data
  const updated = await prisma.tournament.update({
    where: { id },
    data: { ...rest, ...(description !== undefined ? { description: description ?? '' } : {}) },
  })
  return Response.json({ id: updated.id, title: updated.title, startDate: updated.startDate })
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  // [REVIEW-FIX: backend-security #37] organizer edit/cancel of the tournament itself;
  // 30/min/user.
  const { allowed } = await rateLimit(`tournament:edit:${session.user.id}`, 30, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })
  const { id } = await params

  const { error, tournament } = await authorizeTournamentOrganizer(id, session.user.id, {
    id: true,
    createdById: true,
    startedAt: true,
  })
  if (error) return error

  // Phase 16 item 6 — a started tournament is a real, already-running event (and may have
  // locked-deck snapshots other participants are relying on); "Turnier absagen" is only for
  // the pre-start planning stage. The UI already hides the button once started, this is the
  // server-side backstop (standing rule: never trust the client-side gate alone).
  if (tournament.startedAt) return Response.json({ error: 'already_started' }, { status: 409 })

  await prisma.$transaction([
    prisma.match.deleteMany({ where: { tournamentId: id } }),
    prisma.stageStanding.deleteMany({ where: { stage: { tournamentId: id } } }),
    prisma.tournamentStage.deleteMany({ where: { tournamentId: id } }),
    prisma.tournamentParticipant.deleteMany({ where: { tournamentId: id } }),
    prisma.tournament.delete({ where: { id } }),
  ])
  return new Response(null, { status: 204 })
}
