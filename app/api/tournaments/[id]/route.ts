// app/api/tournaments/[id]/route.ts
// PATCH — edit a Tournament. AUTHZ RULE (standing Global-Constraints requirement): only the
// owner (createdById, always from the session at create time) or a user with the ADMIN role may
// modify a tournament; everyone else gets 403 (negative test: tests/integration/tournament-ownership.test.ts).
// DELETE — same authz rule; participant rows and matches are removed in the same transaction
// (both FKs to Tournament have no cascade in spec §3, and participants' registrations must not
// block an organizer from cancelling their own event).
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { parseTournamentInput } from '@/lib/tournamentValidation'

type Ctx = { params: Promise<{ id: string }> }

async function loadAuthorized(id: string, userId: string) {
  const tournament = await prisma.tournament.findUnique({ where: { id }, select: { id: true, createdById: true } })
  if (!tournament) return { error: Response.json({ error: 'not_found' }, { status: 404 }) }
  const caller = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (tournament.createdById !== userId && caller?.role !== 'ADMIN') {
    return { error: Response.json({ error: 'forbidden' }, { status: 403 }) }
  }
  return { tournament }
}

export async function PATCH(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const { error } = await loadAuthorized(id, session.user.id)
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
  const { id } = await params

  const { error } = await loadAuthorized(id, session.user.id)
  if (error) return error

  await prisma.$transaction([
    prisma.match.deleteMany({ where: { tournamentId: id } }),
    prisma.tournamentParticipant.deleteMany({ where: { tournamentId: id } }),
    prisma.tournament.delete({ where: { id } }),
  ])
  return new Response(null, { status: 204 })
}
