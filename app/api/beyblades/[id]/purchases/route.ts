// app/api/beyblades/[id]/purchases/route.ts (MVP4, #139/#142; #137-Nachtrag)
// "Beyblade als gekauft markieren" auf der Beyblade-Detailseite (PurchaseForm) — der Weg, den
// echte Nutzer:innen tatsächlich gehen. Schreibt EINE Purchase-Row (User ↔ Beyblade, unbegrenzt
// viele pro User+Set, einzeln editier-/löschbar über /api/purchases/[id], Basis des
// Preisverlaufs) UND — seit dem #137-Nachtrag — je belegtem Teile-Slot eine verknüpfte
// CollectionItem-Row (dieselbe Logik wie /api/collection/mark-set-purchased, jetzt geteilt in
// lib/beybladePurchase.ts). Vorher schrieb diese Route NUR die Purchase-Row (PR #142 hatte das
// bewusst getrennt) — live reproduziert: "✓ Im Besitz" erschien im Katalog (Purchase-basiert),
// aber "Mein Inventar" (CollectionItem-basiert, laut app/collection/page.tsx die
// Verfügbarkeitsgrundlage von "Meine Builds") blieb leer, weil dieser — der einzige Weg, den
// Nutzer:innen von der Detailseite aus tatsächlich nehmen — nie eine Provenienz-Zeile erzeugte.
// AUTHZ RULE (standing Global-Constraints requirement): owner-only — die Zeilen werden immer
// für session.user.id angelegt, nie für eine body-supplied userId.
import { auth } from '@/lib/auth'
import { rateLimit } from '@/lib/rateLimit'
import { parsePurchaseBody } from '@/lib/purchaseInput'
import { createBeybladePurchase } from '@/lib/beybladePurchase'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { allowed } = await rateLimit(`beyblade:purchase:${session.user.id}`, 30, 60 * 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = parsePurchaseBody(body)
  if (parsed.error) return Response.json({ error: parsed.error }, { status: 400 })

  const { id: beybladeId } = await params
  const { merchant, boughtAt, price, currency } = parsed.fields ?? {}
  const result = await createBeybladePurchase(session.user.id, beybladeId, { price, currency, merchant, boughtAt })
  if ('error' in result) return Response.json({ error: result.error }, { status: 404 })

  return Response.json({ purchaseId: result.purchaseId, itemIds: result.itemIds }, { status: 201 })
}
