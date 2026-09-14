// app/api/collection/mark-set-purchased/route.ts (Phase 11, item 6; RC16 #122; MVP4 #141)
// "Set als gekauft markieren" (Formular auf /collection?tab=inventar&neu=1) — selecting a
// Beyblade (offizielles Set) and marking it purchased writes ONE Purchase row (User ↔ Beyblade,
// die Besitz-Einheit — unbegrenzt viele pro User+Set, einzeln löschbar, Basis des
// Preisverlaufs) und erzeugt zusätzlich je belegtem Slot EINE verknüpfte CollectionItem-Row
// (je nach Bauform 2–6: Standard 3, Ratchet-Integrated 2, Custom Line 6) mit derselben
// Kaufangabe als Provenienz (sourceBeybladeId). Die CollectionItem-Rows bleiben eigenständig
// editier-/löschbar über die bestehenden Single-Part-Routen (z. B. wenn der User später nur
// das Bit verkauft). Dieselbe Schreiblogik wie POST /api/beyblades/[id]/purchases (der
// Detailseiten-Button) — beide rufen lib/beybladePurchase.ts (#137-Nachtrag: die beiden Routen
// hatten vorher UNTERSCHIEDLICHES Verhalten, siehe dortiger Kommentar). AUTHZ RULE (standing
// Global-Constraints requirement): owner-only — die Zeilen werden immer für session.user.id
// angelegt, nie für eine body-supplied userId (negative test in
// tests/integration/mark-set-purchased.test.ts).
import { auth } from '@/lib/auth'
import { rateLimit } from '@/lib/rateLimit'
import { parseCollectionItemBody } from '@/lib/collectionItemBody'
import { createBeybladePurchase } from '@/lib/beybladePurchase'

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

  const { purchasePrice, currency, merchant, boughtAt } = parsed.fields ?? {}
  const result = await createBeybladePurchase(session.user.id, beybladeId, { price: purchasePrice, currency, merchant, boughtAt })
  if ('error' in result) return Response.json({ error: result.error }, { status: 404 })

  return Response.json({ purchaseId: result.purchaseId, ids: result.itemIds }, { status: 201 })
}
