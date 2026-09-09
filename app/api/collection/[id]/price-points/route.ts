// app/api/collection/[id]/price-points/route.ts
// Preisverlauf (Phase 5 Part B): log an additional price observation for an OWNED
// CollectionItem. AUTHZ RULE (standing Global-Constraints requirement): owner-only —
// 401 unauthenticated; a non-owner (or unknown item id) gets 404, not 403 — the item's
// existence isn't leaked (negative test in tests/integration/collection-authz.test.ts).
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { FX_CURRENCIES, type FxCurrency } from '@/lib/currency'

const PRICE_MAX = 10_000_000

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { allowed } = await rateLimit(`collection:price:${session.user.id}`, 60, 60 * 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  const { id } = await params
  const item = await prisma.collectionItem.findUnique({ where: { id }, select: { id: true, userId: true } })
  if (!item || item.userId !== session.user.id) return Response.json({ error: 'not_found' }, { status: 404 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null) return Response.json({ error: 'invalid_body' }, { status: 400 })
  const b = body as { price?: unknown; currency?: unknown; recordedAt?: unknown }

  const price = Number(b.price)
  if (!Number.isFinite(price) || price <= 0 || price > PRICE_MAX) {
    return Response.json({ error: 'invalid_price' }, { status: 400 })
  }
  const currency = (b.currency === undefined ? 'EUR' : b.currency) as FxCurrency
  if (typeof b.currency !== 'undefined' && (typeof b.currency !== 'string' || !FX_CURRENCIES.includes(currency))) {
    return Response.json({ error: 'invalid_currency' }, { status: 400 })
  }
  let recordedAt = new Date()
  if (b.recordedAt !== undefined) {
    if (typeof b.recordedAt !== 'string') return Response.json({ error: 'invalid_recordedAt' }, { status: 400 })
    const parsed = new Date(b.recordedAt)
    if (Number.isNaN(parsed.getTime())) return Response.json({ error: 'invalid_recordedAt' }, { status: 400 })
    recordedAt = parsed
  }

  const point = await prisma.pricePoint.create({
    data: {
      collectionItemId: id,
      price: Math.round(price * 100) / 100,
      currency,
      recordedAt,
    },
  })
  return Response.json({ id: point.id }, { status: 201 })
}
