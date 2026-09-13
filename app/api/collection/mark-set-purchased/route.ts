// app/api/collection/mark-set-purchased/route.ts (Phase 11, item 6; RC16 #122; MVP4 #141)
// "Set als gekauft markieren" — selecting a Beyblade (offizielles Set) and marking it purchased
// writes ONE Purchase row (User ↔ Beyblade, die neue Besitz-Einheit — unbegrenzt viele pro
// User+Set, einzeln löschbar, Basis des Preisverlaufs) und erzeugt zusätzlich je belegtem Slot
// EINE verknüpfte CollectionItem-Row (je nach Bauform 2–6: Standard 3, Ratchet-Integrated 2,
// Custom Line 6) mit derselben Kaufangabe als Provenienz (sourceBeybladeId). Die CollectionItem-
// Rows bleiben eigenständig editier-/löschbar über die bestehenden Single-Part-Routen (z. B.
// wenn der User später nur das Bit verkauft). AUTHZ RULE (standing Global-Constraints
// requirement): owner-only — die Zeilen werden immer für session.user.id angelegt, nie für eine
// body-supplied userId (negative test in tests/integration/mark-set-purchased.test.ts).
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
  const beybladeId = typeof b.beybladeId === 'string' && b.beybladeId.length > 0 ? b.beybladeId : null
  if (!beybladeId) return Response.json({ error: 'invalid_beybladeId' }, { status: 400 })

  // Reuse the single-part form's field parser for the shared purchase fields (price/currency/
  // merchant/boughtAt) — same validation, no second implementation. requirePart: false since
  // this route supplies its own partIds from the Set, not a client-picked one.
  const parsed = parseCollectionItemBody(body, { requirePart: false })
  if (parsed.error) return Response.json({ error: parsed.error }, { status: 400 })

  const beyblade = await prisma.beyblade.findUnique({
    where: { id: beybladeId },
    select: {
      id: true,
      bladeId: true,
      lockChipId: true,
      overBladeId: true,
      metalBladeId: true,
      assistBladeId: true,
      ratchetId: true,
      bitId: true,
    },
  })
  if (!beyblade) return Response.json({ error: 'not_found' }, { status: 404 })

  const { purchasePrice, currency, merchant, boughtAt } = parsed.fields ?? {}
  const userId = session.user.id

  // RC16 (#122) — je belegtem Slot eine CollectionItem-Row; leere Slots (Ratchet-Integrated,
  // CX-Blade) erzeugen bewusst keine Row.
  const partIds = [
    beyblade.bladeId,
    beyblade.lockChipId,
    beyblade.overBladeId,
    beyblade.metalBladeId,
    beyblade.assistBladeId,
    beyblade.ratchetId,
    beyblade.bitId,
  ].filter((id): id is string => id !== null)

  // Purchase + Provenienz-Rows in EINER Transaktion: beide oder keine (kein halber Kauf).
  const [purchase, ...items] = await prisma.$transaction([
    prisma.purchase.create({
      data: {
        userId,
        beybladeId: beyblade.id,
        price: purchasePrice ?? null,
        currency: currency ?? 'EUR',
        merchant: merchant ?? null,
        boughtAt: boughtAt ?? null,
      },
    }),
    ...partIds.map((partOrBeyId) =>
      prisma.collectionItem.create({
        data: {
          userId,
          partOrBeyId,
          sourceBeybladeId: beyblade.id,
          purchasePrice: purchasePrice ?? null,
          currency: currency ?? 'EUR',
          merchant: merchant ?? null,
          boughtAt: boughtAt ?? null,
        },
      }),
    ),
  ])
  return Response.json({ purchaseId: purchase.id, ids: items.map((i) => i.id) }, { status: 201 })
}
