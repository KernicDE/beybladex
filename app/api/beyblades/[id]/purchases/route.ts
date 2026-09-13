// app/api/beyblades/[id]/purchases/route.ts (MVP4, #139/#142)
// "Beyblade als gekauft markieren" — der kanonische Kauf-Endpunkt des Kauf-Flows. Schreibt
// EINE Purchase-Row (User ↔ Beyblade, unbegrenzt viele pro User+Set, einzeln editier-/löschbar
// über /api/purchases/[id], Basis des Preisverlaufs). Bewusst KEINE CollectionItem-Provenienz
// hier: die Teile-Einträge aus einem Set-Kauf bleiben Sache von
// /api/collection/mark-set-purchased (RC16 #122) — siehe PR #142 für die Trennung. AUTHZ RULE
// (standing Global-Constraints requirement): owner-only — die Row wird immer für
// session.user.id angelegt, nie für eine body-supplied userId.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { parsePurchaseBody } from '@/lib/purchaseInput'

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
  const beyblade = await prisma.beyblade.findUnique({ where: { id: beybladeId }, select: { id: true } })
  if (!beyblade) return Response.json({ error: 'not_found' }, { status: 404 })

  const { merchant, boughtAt, price, currency } = parsed.fields ?? {}
  const purchase = await prisma.purchase.create({
    data: {
      userId: session.user.id,
      beybladeId: beyblade.id,
      merchant: merchant ?? null,
      boughtAt: boughtAt ?? null,
      price: price ?? null,
      currency: currency ?? 'EUR',
    },
  })
  return Response.json({ purchase }, { status: 201 })
}
