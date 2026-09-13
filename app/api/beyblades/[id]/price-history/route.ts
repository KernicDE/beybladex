// app/api/beyblades/[id]/price-history/route.ts (MVP4, #139/#142)
// Öffentliches Preisverlauf-Aggregat einer Beyblade: alle gemeldeten Kaufpreise gruppiert nach
// Währung, chronologisch (boughtAt ?? createdAt). Reine Daten-Form — das Rendering (Chart auf
// der Detailseite) ist Sache von #144; #142 liefert das Daten-Fundament + die lib.
import { prisma } from '@/lib/db'
import { shapePriceHistory } from '@/lib/purchasePriceHistory'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params

  const beyblade = await prisma.beyblade.findUnique({ where: { id }, select: { id: true } })
  if (!beyblade) return Response.json({ error: 'not_found' }, { status: 404 })

  const rows = await prisma.purchase.findMany({
    where: { beybladeId: id, price: { not: null } },
    select: { price: true, currency: true, boughtAt: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })

  const shaped = shapePriceHistory(rows)
  const series = Object.fromEntries(
    Object.entries(shaped).map(([currency, points]) => [
      currency,
      points.map((p) => ({ price: p.price, date: p.date.toISOString() })),
    ]),
  )
  return Response.json({ series }, { status: 200 })
}
