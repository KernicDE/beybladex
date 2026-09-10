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
import { validateDeckForFormat } from '@/lib/deckValidation'

type Ctx = { params: Promise<{ id: string }> }

async function ownDeck(deckId: unknown, userId: string): Promise<boolean> {
  if (deckId === undefined || deckId === null) return true
  if (typeof deckId !== 'string') return false
  const deck = await prisma.deck.findUnique({ where: { id: deckId }, select: { userId: true } })
  return deck?.userId === userId
}

// Phase 16 item 5 — re-validates a chosen deck against the TOURNAMENT'S linked
// Ruleset.deckFormat: a genuinely new check (join previously accepted any deckId belonging to
// the caller with no format cross-check at all). Returns null (valid) or the error payload.
async function validateDeckAgainstTournamentFormat(
  deckId: string,
  tournamentId: string
): Promise<{ error: string; conflicts?: string[] } | null> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { ruleset: { select: { deckFormat: true } } },
  })
  if (!tournament) return { error: 'not_found' }
  const deck = await prisma.deck.findUnique({
    where: { id: deckId },
    include: {
      builds: {
        include: {
          build: {
            select: {
              id: true, bladeId: true, ratchetId: true, bitId: true,
              blade: { select: { name: true } }, ratchet: { select: { name: true } }, bit: { select: { name: true } },
            },
          },
        },
      },
    },
  })
  if (!deck) return { error: 'invalid_deck' }
  const { valid, conflicts } = validateDeckForFormat(deck.builds.map((db) => db.build), tournament.ruleset.deckFormat)
  if (!valid) return { error: 'deck_format_mismatch', conflicts }
  return null
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
  if (typeof deckId === 'string') {
    const formatError = await validateDeckAgainstTournamentFormat(deckId, id)
    if (formatError) return Response.json(formatError, { status: 400 })
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
  if (typeof deckId === 'string') {
    const formatError = await validateDeckAgainstTournamentFormat(deckId, id)
    if (formatError) return Response.json(formatError, { status: 400 })
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
