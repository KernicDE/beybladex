// app/api/decks/[id]/route.ts
// PATCH — update one of the caller's OWN decks: rename it and/or replace its build list
// (positions are the array order). AUTHZ RULE (standing Global-Constraints requirement):
// owner-only — 401 unauthenticated, 404 for a deck the caller doesn't own (existence of
// someone else's deck isn't leaked), negative test in tests/integration/deck-api.test.ts.
// The no-duplicate-parts deck rule is re-validated server-side on every replacement, and the
// DeckBuild @@unique([deckId, buildId]) constraint remains the DB-layer backstop.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
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
  const b = body as { title?: unknown; buildIds?: unknown }

  let title: string | undefined
  if (b.title !== undefined) {
    if (typeof b.title !== 'string' || b.title.trim().length === 0) return Response.json({ error: 'invalid_title' }, { status: 400 })
    title = b.title.trim().slice(0, TITLE_MAX)
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
      include: { blade: { select: { name: true } }, ratchet: { select: { name: true } }, bit: { select: { name: true } } },
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
  })
  return Response.json({ ok: true }, { status: 200 })
}
