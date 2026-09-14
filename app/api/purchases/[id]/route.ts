// app/api/purchases/[id]/route.ts (MVP4, #139/#142)
// Single-Purchase-Mutationen: Edit (Händler/Datum/Preis/Währung) und Delete. AUTHZ RULE
// (standing Global-Constraints requirement): owner-only — 401 unauthenticated; ein Nicht-
// Besitzer, der fremde ids anfasst, bekommt 404, nicht 403 (die Existenz der Zeile wird nicht
// geleakt, gleiche Idiom wie app/api/collection/[id]). Issue #169 (Live-Report: "Teile werden
// nicht mit Beyblade gelöscht") — das Löschen einer Purchase kaskadiert jetzt DB-seitig auf ihre
// CollectionItem-Zeilen (CollectionItem.purchaseId, onDelete: Cascade, siehe schema.prisma) und
// deren PricePoints (die hängen bereits an CollectionItem). Kein explizites App-Code nötig — der
// einzelne prisma.purchase.delete() unten reicht, die FK erledigt den Rest. Alt-Zeilen aus VOR
// dieser Migration ohne eindeutig rekonstruierbaren purchaseId (mehrfacher Kauf derselben
// Beyblade) bleiben unverknüpft — siehe die Backfill-Migration für die genaue Abgrenzung.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { parsePurchaseBody } from '@/lib/purchaseInput'

type Ctx = { params: Promise<{ id: string }> }

async function ownPurchase(id: string, userId: string) {
  const purchase = await prisma.purchase.findUnique({ where: { id }, select: { id: true, userId: true } })
  if (!purchase || purchase.userId !== userId) return null
  return purchase
}

export async function PATCH(req: Request, { params }: Ctx): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  if (!(await ownPurchase(id, session.user.id))) return Response.json({ error: 'not_found' }, { status: 404 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = parsePurchaseBody(body)
  if (parsed.error) return Response.json({ error: parsed.error }, { status: 400 })
  const { merchant, boughtAt, price, currency } = parsed.fields ?? {}

  await prisma.purchase.update({
    where: { id },
    data: {
      ...(merchant !== undefined ? { merchant } : {}),
      ...(boughtAt !== undefined ? { boughtAt } : {}),
      ...(price !== undefined ? { price } : {}),
      ...(currency ? { currency } : {}),
    },
  })
  return Response.json({ ok: true }, { status: 200 })
}

export async function DELETE(_req: Request, { params }: Ctx): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params
  if (!(await ownPurchase(id, session.user.id))) return Response.json({ error: 'not_found' }, { status: 404 })

  await prisma.purchase.delete({ where: { id } })
  return Response.json({ ok: true }, { status: 200 })
}
