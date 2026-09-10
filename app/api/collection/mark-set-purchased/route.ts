// app/api/collection/mark-set-purchased/route.ts (Phase 11, item 6)
// "Set als gekauft markieren" — selecting an official Build (isOfficialSet: true) and marking
// it purchased creates THREE linked CollectionItem rows (one per constituent part: blade,
// ratchet, bit), sharing the entered purchasePrice/currency/merchant/boughtAt. This is
// provenance, not a new ownership unit — the three rows stay independently editable/deletable
// afterward via the existing single-Part collection routes (e.g. if the user later sells just
// the bit). AUTHZ RULE (standing Global-Constraints requirement): owner-only — the three rows
// are always created for session.user.id, never a body-supplied userId (negative test in
// tests/integration/mark-set-purchased.test.ts).
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { parseCollectionItemBody } from '@/lib/collectionItemBody'

export async function POST(req: Request): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { allowed } = await rateLimit(`collection:mark-set-purchased:${session.user.id}`, 30, 60 * 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const b = body as Record<string, unknown>
  const buildId = typeof b.buildId === 'string' && b.buildId.length > 0 ? b.buildId : null
  if (!buildId) return Response.json({ error: 'invalid_buildId' }, { status: 400 })

  // Reuse the single-part form's field parser for the shared purchase fields (price/currency/
  // merchant/boughtAt) — same validation, no second implementation. requirePart: false since
  // this route supplies its own three partIds from the Set, not a client-picked one.
  const parsed = parseCollectionItemBody(body, { requirePart: false })
  if (parsed.error) return Response.json({ error: parsed.error }, { status: 400 })

  const build = await prisma.build.findUnique({
    where: { id: buildId },
    select: { id: true, isOfficialSet: true, bladeId: true, ratchetId: true, bitId: true },
  })
  if (!build) return Response.json({ error: 'not_found' }, { status: 404 })
  if (!build.isOfficialSet) return Response.json({ error: 'not_an_official_set' }, { status: 400 })

  const { purchasePrice, currency, merchant, boughtAt } = parsed.fields ?? {}
  const shared = {
    userId: session.user.id,
    sourceBuildId: build.id,
    purchasePrice: purchasePrice ?? null,
    currency: currency ?? 'EUR',
    merchant: merchant ?? null,
    boughtAt: boughtAt ?? null,
  }

  const items = await prisma.$transaction([
    prisma.collectionItem.create({ data: { ...shared, partOrBeyId: build.bladeId } }),
    prisma.collectionItem.create({ data: { ...shared, partOrBeyId: build.ratchetId } }),
    prisma.collectionItem.create({ data: { ...shared, partOrBeyId: build.bitId } }),
  ])
  return Response.json({ ids: items.map((i) => i.id) }, { status: 201 })
}
