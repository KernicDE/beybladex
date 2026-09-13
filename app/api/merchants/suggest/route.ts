// app/api/merchants/suggest/route.ts (MVP4, #139/#142)
// Händler-Autocomplete für den Kauf-Dialog: DISTINCT merchant aus allen Purchase-Zeilen,
// Prefix-Match case-insensitive, LIMIT 8. #139: "Wenn jemand schon Amazon.de eingegeben hat,
// dann soll das vorgeschlagen werden, wenn ein anderer User 'Ama' eingegeben hat."
// Session-required wie das Geo-Autocomplete (app/api/geo/autocomplete): nur angemeldete
// Keystrokes werden beantwortet — die Merchant-Namen kommen zwar aus der eigenen DB (kein
// Externdienst), aber das Endpoint bleibt bewusst kein offenes Query-Fenster.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'

const MIN_QUERY = 3
const LIMIT = 8

export async function GET(req: Request): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { allowed } = await rateLimit(`merchants:suggest:${session.user.id}`, 60, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  const q = (new URL(req.url).searchParams.get('q') ?? '').trim()
  if (q.length < MIN_QUERY) return Response.json({ error: 'invalid_query' }, { status: 400 })

  const rows = await prisma.purchase.findMany({
    where: { merchant: { startsWith: q, mode: 'insensitive' } },
    select: { merchant: true },
    distinct: ['merchant'],
    orderBy: { merchant: 'asc' },
    take: LIMIT,
  })
  const merchants = rows.map((r) => r.merchant).filter((m): m is string => m !== null)
  return Response.json({ merchants }, { status: 200 })
}
