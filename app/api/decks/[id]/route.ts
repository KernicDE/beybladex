// app/api/decks/[id]/route.ts
// PATCH — update one of the caller's OWN decks: rename it, replace its build list
// (positions are the array order) and/or toggle its visibility (#144: PUBLIC = in
// öffentlichen Listungen sichtbar, UNLISTED = nicht gelistet aber niemals geheim — per
// Direktlink/Turnier sichtbar). AUTHZ RULE (standing Global-Constraints requirement):
// owner-only — 401 unauthenticated, 404 for a deck the caller doesn't own (existence of
// someone else's deck isn't leaked), negative test in tests/integration/deck-api.test.ts.
// The no-duplicate-parts deck rule is re-validated server-side on every replacement, and the
// DeckBuild @@unique([deckId, buildId]) constraint remains the DB-layer backstop.
// DELETE (#164) — dieselbe Owner-only-Prüfung. Anders als bei Builds (#161) ist hier KEIN
// P2003-Fall zu erwarten: DeckBuild.deckId ist ON DELETE CASCADE, TournamentParticipant.deckId
// und TeamTournamentSlot.deckId sind beide ON DELETE SET NULL (verifiziert in
// prisma/migrations/00000000000000_init bzw. .../20260911130000_rc15_team_3v3) — ein Deck ist
// also IMMER löschbar, auch wenn es in Turnieren registriert war/ist. Der Fehlerpfad bleibt
// trotzdem defensiv erhalten (derselbe Übersetzungs-Idiom wie bei Builds), falls sich das je
// ändert.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { Prisma } from '@prisma/client'
import { validateNoDuplicateParts } from '@/lib/deckValidation'

const TITLE_MAX = 80
const MAX_BUILDS = 3
type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const deck = await prisma.deck.findUnique({ where: { id }, select: { id: true, userId: true } })
  if (!deck || deck.userId !== session.user.id) return Response.json({ error: 'not_found' }, { status: 404 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null) return Response.json({ error: 'invalid_body' }, { status: 400 })
  const b = body as { title?: unknown; buildIds?: unknown; visibility?: unknown }

  let title: string | undefined
  if (b.title !== undefined) {
    if (typeof b.title !== 'string' || b.title.trim().length === 0) return Response.json({ error: 'invalid_title' }, { status: 400 })
    title = b.title.trim().slice(0, TITLE_MAX)
  }

  // #144 — Sichtbarkeits-Umschalter: nur die beiden Werte des Visibility-Enums sind zulässig.
  let visibility: 'PUBLIC' | 'UNLISTED' | undefined
  if (b.visibility !== undefined) {
    if (b.visibility !== 'PUBLIC' && b.visibility !== 'UNLISTED') {
      return Response.json({ error: 'invalid_visibility' }, { status: 400 })
    }
    visibility = b.visibility
  }

  let buildIds: string[] | undefined
  if (b.buildIds !== undefined) {
    if (!Array.isArray(b.buildIds) || b.buildIds.some((x) => typeof x !== 'string') || b.buildIds.length > MAX_BUILDS) {
      return Response.json({ error: 'invalid_buildIds' }, { status: 400 })
    }
    buildIds = [...new Set(b.buildIds as string[])]
  }

  if (buildIds) {
    const builds = await prisma.build.findMany({
      where: { id: { in: buildIds } },
      include: {
        blade: { select: { name: true } }, lockChip: { select: { name: true } },
        overBlade: { select: { name: true } }, metalBlade: { select: { name: true } },
        assistBlade: { select: { name: true } }, ratchet: { select: { name: true } }, bit: { select: { name: true } },
      },
    })
    if (builds.length !== buildIds.length) return Response.json({ error: 'unknown_build' }, { status: 400 })
    const { valid, conflicts } = validateNoDuplicateParts(builds)
    if (!valid) return Response.json({ error: 'duplicate_parts', conflicts }, { status: 400 })
  }

  await prisma.$transaction(async (tx) => {
    if (buildIds) {
      await tx.deckBuild.deleteMany({ where: { deckId: id } })
      await tx.deckBuild.createMany({ data: buildIds.map((buildId, i) => ({ deckId: id, buildId, position: i + 1 })) })
    }
    if (title) await tx.deck.update({ where: { id }, data: { title } })
    if (visibility) await tx.deck.update({ where: { id }, data: { visibility } })
  })
  return Response.json({ ok: true }, { status: 200 })
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const deck = await prisma.deck.findUnique({ where: { id }, select: { userId: true } })
  if (!deck || deck.userId !== session.user.id) return Response.json({ error: 'not_found' }, { status: 404 })

  try {
    await prisma.deck.delete({ where: { id } })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2003') {
      return Response.json({ error: 'deck_in_use' }, { status: 409 })
    }
    throw err
  }
  return Response.json({ ok: true }, { status: 200 })
}
