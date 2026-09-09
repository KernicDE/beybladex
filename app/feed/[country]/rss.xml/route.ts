// app/feed/[country]/rss.xml/route.ts (Phase 3)
// Country-scoped tournament feed (de|at|ch). Same ISR contract as the DACH-wide feed.
import { prisma } from '@/lib/db'
import { buildTournamentFeed } from '@/lib/rss'

export const revalidate = 900

const COUNTRIES = ['de', 'at', 'ch'] as const

export async function GET(_req: Request, ctx: RouteContext<'/feed/[country]/rss.xml'>) {
  const { country } = await ctx.params
  if (!COUNTRIES.includes(country as (typeof COUNTRIES)[number])) {
    return Response.json({ error: 'unknown_country' }, { status: 404 })
  }

  let tournaments
  try {
    tournaments = await prisma.tournament.findMany({
      where: { country: country.toUpperCase() as 'DE' | 'AT' | 'CH', startDate: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      orderBy: { startDate: 'asc' },
      take: 100,
    })
  } catch (err) {
    if (process.env.NEXT_PHASE === 'phase-production-build') {
      return rssResponse(buildTournamentFeed([], { country }))
    }
    throw err
  }
  return rssResponse(buildTournamentFeed(tournaments, { country }))
}

function rssResponse(xml: string) {
  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  })
}
