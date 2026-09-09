// app/feed/[country]/[state]/rss.xml/route.ts (Phase 3)
// State-scoped tournament feed (e.g. /feed/de/bayern/rss.xml). Same ISR contract.
import { prisma } from '@/lib/db'
import { buildTournamentFeed } from '@/lib/rss'

export const revalidate = 900

const COUNTRIES = ['de', 'at', 'ch'] as const
const STATE_RE = /^[a-z0-9äöüß-]{1,50}$/i

export async function GET(_req: Request, ctx: RouteContext<'/feed/[country]/[state]/rss.xml'>) {
  const { country, state } = await ctx.params
  if (!COUNTRIES.includes(country as (typeof COUNTRIES)[number]) || !STATE_RE.test(state)) {
    return Response.json({ error: 'unknown_scope' }, { status: 404 })
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
      return rssResponse(buildTournamentFeed([], { country, state }))
    }
    throw err
  }
  return rssResponse(buildTournamentFeed(tournaments, { country, state }))
}

function rssResponse(xml: string) {
  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  })
}
