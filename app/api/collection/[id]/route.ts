// app/api/collection/[id]/route.ts
// Single CollectionItem mutations (Phase 5 Part B). AUTHZ RULE (standing Global-Constraints
// requirement): owner-only. 401 unauthenticated; a non-owner touching someone else's item id
// gets 404, not 403 — the item's existence isn't leaked (negative test in
// tests/integration/collection-authz.test.ts).
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { parseCollectionItemBody } from '@/lib/collectionItemBody'

type Ctx = { params: Promise<{ id: string }> }

async function ownItem(id: string, userId: string) {
  const item = await prisma.collectionItem.findUnique({ where: { id }, select: { id: true, userId: true } })
  if (!item || item.userId !== userId) return null
  return item
}

export async function PATCH(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  if (!(await ownItem(id, session.user.id))) return Response.json({ error: 'not_found' }, { status: 404 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = parseCollectionItemBody(body, { requirePart: false })
  if (parsed.error) return Response.json({ error: parsed.error }, { status: 400 })
  const { partId, purchasePrice, currency, merchant, boughtAt } = parsed.fields!

  if (partId) {
    const part = await prisma.part.findUnique({ where: { id: partId }, select: { id: true } })
    if (!part) return Response.json({ error: 'unknown_part' }, { status: 400 })
  }

  await prisma.collectionItem.update({
    where: { id },
    data: {
      ...(partId ? { partOrBeyId: partId } : {}),
      ...(purchasePrice !== undefined ? { purchasePrice } : {}),
      ...(currency ? { currency } : {}),
      ...(merchant !== undefined ? { merchant } : {}),
      ...(boughtAt !== undefined ? { boughtAt } : {}),
    },
  })
  return Response.json({ ok: true }, { status: 200 })
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  if (!(await ownItem(id, session.user.id))) return Response.json({ error: 'not_found' }, { status: 404 })

  // PricePoint rows die via onDelete: Cascade at the DB level.
  await prisma.collectionItem.delete({ where: { id } })
  return Response.json({ ok: true }, { status: 200 })
}
