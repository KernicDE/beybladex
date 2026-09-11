// app/api/tournaments/[id]/team-entries/[entryId]/slots/[position]/route.ts (RC15, issue #12)
// A lineup slot's DECK selection. AUTHZ RULE: ONLY the slot's own user may set their deck
// (deck ownership is personal — a captain can never field a build on a member's behalf, same
// standing rule as the solo join route's ownDeck check). ADMINs pass too (support tier).
// WINDOW: deck edits close at Tournament.startDate AND at "Turnier starten" (startedAt) —
// the exact Phase-16 lock-bypass prevention the solo PATCH route carries: after the deck
// snapshot, a deck swap must not repoint lockedBuildIds at a different live deck.
// VALIDATION: deckId must belong to the slot user and validate against the tournament's
// Ruleset.deckFormat (lib/deckRegistration.ts — the same check the solo join route uses).
import { requireUser, getCallerRole } from '@/lib/guards'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { validateDeckAgainstTournamentFormat } from '@/lib/deckRegistration'
import { invalidatePublicCache, publicTournamentKey } from '@/lib/publicCache'

type Ctx = { params: Promise<{ id: string; entryId: string; position: string }> }

export async function PATCH(req: Request, { params }: Ctx) {
  const gate = await requireUser()
  if ('error' in gate) return gate.error
  const { allowed } = await rateLimit(`tournament:team-join:${gate.userId}`, 60, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })
  const { id, entryId, position: positionParam } = await params
  const position = Number.parseInt(positionParam, 10)
  if (!Number.isInteger(position) || position < 1 || position > 3) {
    return Response.json({ error: 'invalid_slot' }, { status: 400 })
  }

  const slot = await prisma.teamTournamentSlot.findUnique({
    where: { entryId_position: { entryId, position } },
    include: { entry: { select: { tournamentId: true } } },
  })
  if (!slot || slot.entry.tournamentId !== id) return Response.json({ error: 'not_found' }, { status: 404 })

  const role = await getCallerRole(gate.userId)
  if (slot.userId !== gate.userId && role !== 'ADMIN') {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  const tournament = await prisma.tournament.findUnique({ where: { id }, select: { startDate: true, startedAt: true } })
  if (!tournament) return Response.json({ error: 'not_found' }, { status: 404 })
  if (new Date() > tournament.startDate || tournament.startedAt !== null) {
    return Response.json({ error: 'tournament_started' }, { status: 409 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const deckId = body.deckId
  if (deckId !== null && typeof deckId !== 'string') {
    return Response.json({ error: 'invalid_deck' }, { status: 400 })
  }
  if (typeof deckId === 'string') {
    const deck = await prisma.deck.findUnique({ where: { id: deckId }, select: { userId: true } })
    if (deck?.userId !== slot.userId) return Response.json({ error: 'invalid_deck' }, { status: 403 })
    const formatError = await validateDeckAgainstTournamentFormat(deckId, id)
    if (formatError) return Response.json(formatError, { status: 400 })
  }

  await prisma.teamTournamentSlot.update({
    where: { entryId_position: { entryId, position } },
    data: { deckId },
  })
  // Hotfix #99: the public detail page lists slot decks.
  await invalidatePublicCache(publicTournamentKey(id))
  return Response.json({ ok: true, deckId })
}
