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
import { rateLimit } from '@/lib/rateLimit'
import { invalidatePublicCache, publicTournamentKey } from '@/lib/publicCache'
import { validateDeckAgainstTournamentFormat } from '@/lib/deckRegistration'

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
  // [REVIEW-FIX: backend-security #37] cap a (compromised) session's request rate; 60/min/user is
  // far above any legitimate join / deck-edit / withdraw usage.
  const { allowed } = await rateLimit(`tournament:join:${session.user.id}`, 60, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })
  const { id } = await params

  const tournament = await prisma.tournament.findUnique({
    where: { id },
    select: { startDate: true, startedAt: true, teamMode: true, stages: { select: { _count: { select: { matches: true } } } } },
  })
  if (!tournament) return Response.json({ error: 'not_found' }, { status: 404 })
  // RC15 #12 — team tournaments register TEAMS (TeamTournamentEntry), never solo participants;
  // without this gate a solo row would sit invisibly in the pool-less void of a team event.
  if (tournament.teamMode) return Response.json({ error: 'team_mode' }, { status: 409 })
  const bracketGenerated = tournament.stages.some((s) => s._count.matches > 0)
  // [REVIEW-FIX P16-5] registration also closes once the organizer has explicitly "started" the
  // tournament (Phase 16 item 6, Tournament.startedAt) — not just at startDate/bracket
  // generation. Without this, a player could join AFTER a locked-decks tournament's deck
  // snapshot was already taken, register a deck, and field it with no lock ever applied to
  // them (TournamentParticipant.lockedBuildIds stays empty for a late joiner, which every
  // consumer treats as "no restriction" — exactly the bypass the snapshot exists to prevent).
  if (new Date() > tournament.startDate || bracketGenerated || tournament.startedAt !== null) {
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
    // Hotfix #99: the participants list/count on the cached public detail page changed.
    await invalidatePublicCache(publicTournamentKey(id))
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
  // [REVIEW-FIX: backend-security #37] cap a (compromised) session's request rate; 60/min/user is
  // far above any legitimate join / deck-edit / withdraw usage.
  const { allowed } = await rateLimit(`tournament:join:${session.user.id}`, 60, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })
  const { id } = await params

  const tournament = await prisma.tournament.findUnique({ where: { id }, select: { startDate: true, startedAt: true } })
  if (!tournament) return Response.json({ error: 'not_found' }, { status: 404 })
  // [REVIEW-FIX P16-5] same startedAt gate as POST above — a deck swap after "Turnier starten"
  // would otherwise let a participant change deckId AFTER their (or an empty) snapshot was
  // taken, pointing lockedBuildIds at a deck that no longer matches what deckId now says.
  // (DELETE/withdraw below deliberately does NOT get this gate — dropping out mid-event stays
  // allowed after start; only the deck-content edit this route guards is the lock-bypass risk.)
  if (new Date() > tournament.startDate || tournament.startedAt !== null) {
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
  // [REVIEW-FIX: backend-security #37] cap a (compromised) session's request rate; 60/min/user is
  // far above any legitimate join / deck-edit / withdraw usage.
  const { allowed } = await rateLimit(`tournament:join:${session.user.id}`, 60, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })
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
  // Hotfix #99: the participants list/count on the cached public detail page changed.
  await invalidatePublicCache(publicTournamentKey(id))
  return new Response(null, { status: 204 })
}
