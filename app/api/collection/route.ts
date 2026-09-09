// app/api/collection/route.ts
// Collection manager API (Phase 5 Part B). AUTHZ RULE (standing Global-Constraints requirement):
//   GET  — ?user=<username> returns that user's collection, but ONLY if resolveVisibleFields(...)
//          says collectionVisible for this viewer; not visible (or unknown user) → 404, not 403 —
//          existence isn't leaked (same policy as Phase 2's private rulesets). Without ?user it
//          returns the caller's OWN collection and requires a session (401).
//          Cursor-paginated per the list-endpoint rule.
//   POST — owner-only: creates a CollectionItem for session.user.id. A body can never nominate
//          another owner — userId is never read from the body (negative test in
//          tests/integration/collection-authz.test.ts).
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { resolveVisibleFields } from '@/lib/privacy'
import { isFriendWith } from '@/lib/friendship'
import { parseCollectionItemBody } from '@/lib/collectionItemBody'

const PAGE_SIZE = 20

const PART_SELECT = { id: true, name: true, category: true, manufacturer: true, imageUrl: true } as const

type ItemRow = {
  id: string
  purchasePrice: number | null
  currency: string
  merchant: string | null
  boughtAt: Date | null
  part: { id: string; name: string; category: string; manufacturer: string; imageUrl: string | null }
}

function itemJson(i: ItemRow) {
  return {
    id: i.id,
    part: i.part,
    purchasePrice: i.purchasePrice,
    currency: i.currency,
    merchant: i.merchant,
    boughtAt: i.boughtAt,
  }
}

export async function GET(req: Request) {
  const session = await auth()
  const viewerId = session?.user?.id ?? null
  const url = new URL(req.url)
  const username = url.searchParams.get('user')

  let ownerId: string
  if (username) {
    const subject = await prisma.user.findUnique({ where: { username } })
    if (!subject) return Response.json({ error: 'not_found' }, { status: 404 })
    const isOwner = viewerId === subject.id
    if (!isOwner) {
      const isFriend = viewerId ? await isFriendWith(viewerId, subject.id) : false
      const view = resolveVisibleFields(subject, viewerId, isFriend)
      if (!view.collectionVisible) return Response.json({ error: 'not_found' }, { status: 404 })
    }
    ownerId = subject.id
  } else {
    if (!viewerId) return Response.json({ error: 'unauthorized' }, { status: 401 })
    ownerId = viewerId
  }

  const cursor = url.searchParams.get('cursor')
  const rows = await prisma.collectionItem.findMany({
    where: { userId: ownerId },
    orderBy: { id: 'asc' },
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, purchasePrice: true, currency: true, merchant: true, boughtAt: true, part: { select: PART_SELECT } },
  })
  const hasMore = rows.length > PAGE_SIZE
  const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows
  return Response.json(
    { items: items.map(itemJson), nextCursor: hasMore ? items[items.length - 1]!.id : null },
    { status: 200 },
  )
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { allowed } = await rateLimit(`collection:create:${session.user.id}`, 30, 60 * 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = parseCollectionItemBody(body, { requirePart: true })
  if (parsed.error || !parsed.fields?.partId) return Response.json({ error: parsed.error ?? 'invalid_partId' }, { status: 400 })

  // partOrBeyId is a real FK to Part.id (Phase 5 Part A) — the referenced part must exist.
  const part = await prisma.part.findUnique({ where: { id: parsed.fields.partId }, select: { id: true } })
  if (!part) return Response.json({ error: 'unknown_part' }, { status: 400 })

  const { partId, purchasePrice, currency, merchant, boughtAt } = parsed.fields
  const item = await prisma.collectionItem.create({
    data: {
      userId: session.user.id,
      partOrBeyId: partId!,
      purchasePrice: purchasePrice ?? null,
      currency: currency ?? 'EUR',
      merchant: merchant ?? null,
      boughtAt: boughtAt ?? null,
    },
  })
  return Response.json({ id: item.id }, { status: 201 })
}
