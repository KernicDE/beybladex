// app/api/tournaments/[id]/join/route.ts
// Player registration for a tournament.
// AUTHZ RULES (standing Global-Constraints requirement — negative tests in
// tests/integration/tournament-join-flow.test.ts):
// - POST: any authenticated user joins themselves; the optional body.deckId must belong to the
//   joining user (403 otherwise). The @@unique([tournamentId, userId]) constraint turns a double
//   join into a 409, proving the constraint is load-bearing. REGISTRATION WINDOW (previously
//   missing — this route had NO time gate at all, unlike PATCH/DELETE below): registration
//   closes at the EARLIER of (a) Tournament.startDate, or (b) any stage's bracket/pairing
//   already being generated for this tournament (Match rows exist) — once a bracket exists the
//   participant pool is structurally fixed (arenas/seeding/pairings already computed), so a
//   late joiner could never actually be scheduled into a match even before the event's stated
//   start time.
// - PATCH: only the participant themselves; edits their deckId up until Tournament.startDate
//   (409 afterwards — editable-until-start decision from the master plan).
// - DELETE: only the participant themselves; withdraws up until Tournament.startDate (409 after).
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

type Ctx = { params: Promise<{ id: string }> }

async function ownDeck(deckId: unknown, userId: string): Promise<boolean> {
  if (deckId === undefined || deckId === null) return true
  if (typeof deckId !== 'string') return false
  const deck = await prisma.deck.findUnique({ where: { id: deckId }, select: { userId: true } })
  return deck?.userId === userId
}

export async function POST(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const tournament = await prisma.tournament.findUnique({
    where: { id },
    select: { startDate: true, stages: { select: { _count: { select: { matches: true } } } } },
  })
  if (!tournament) return Response.json({ error: 'not_found' }, { status: 404 })
  const bracketGenerated = tournament.stages.some((s) => s._count.matches > 0)
  if (new Date() > tournament.startDate || bracketGenerated) {
    return Response.json({ error: 'registration_closed' }, { status: 409 })
  }

  let body: unknown = {}
  try {
    body = await req.json()
  } catch {
    // empty body is fine — deckId is optional
  }
  const deckId = (body as Record<string, unknown>).deckId
  if (!(await ownDeck(deckId, session.user.id))) {
    return Response.json({ error: 'invalid_deck' }, { status: 403 })
  }

  try {
    const participant = await prisma.tournamentParticipant.create({
      data: { tournamentId: id, userId: session.user.id, deckId: (deckId as string | undefined) ?? null },
    })
    return Response.json({ id: participant.id, checkedIn: participant.checkedIn }, { status: 201 })
  } catch (e) {
    // P2002: the @@unique([tournamentId, userId]) pair already exists — a duplicate join.
    if (e && typeof e === 'object' && 'code' in e && e.code === 'P2002') {
      return Response.json({ error: 'already_joined' }, { status: 409 })
    }
    throw e
  }
}

export async function PATCH(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const tournament = await prisma.tournament.findUnique({ where: { id }, select: { startDate: true } })
  if (!tournament) return Response.json({ error: 'not_found' }, { status: 404 })
  if (new Date() > tournament.startDate) {
    return Response.json({ error: 'tournament_started' }, { status: 409 })
  }

  const participant = await prisma.tournamentParticipant.findUnique({
    where: { tournamentId_userId: { tournamentId: id, userId: session.user.id } },
  })
  if (!participant) return Response.json({ error: 'not_joined' }, { status: 404 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const deckId = (body as Record<string, unknown>).deckId
  if (deckId !== null && typeof deckId !== 'string') {
    return Response.json({ error: 'invalid_deck' }, { status: 400 })
  }
  if (!(await ownDeck(deckId, session.user.id))) {
    return Response.json({ error: 'invalid_deck' }, { status: 403 })
  }

  const updated = await prisma.tournamentParticipant.update({
    where: { id: participant.id },
    data: { deckId },
  })
  return Response.json({ id: updated.id, deckId: updated.deckId })
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const tournament = await prisma.tournament.findUnique({ where: { id }, select: { startDate: true } })
  if (!tournament) return Response.json({ error: 'not_found' }, { status: 404 })
  if (new Date() > tournament.startDate) {
    return Response.json({ error: 'tournament_started' }, { status: 409 })
  }

  const participant = await prisma.tournamentParticipant.findUnique({
    where: { tournamentId_userId: { tournamentId: id, userId: session.user.id } },
  })
  if (!participant) return Response.json({ error: 'not_joined' }, { status: 404 })

  await prisma.tournamentParticipant.delete({ where: { id: participant.id } })
  return new Response(null, { status: 204 })
}
