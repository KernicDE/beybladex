// app/feed/rss.xml/route.ts (Phase 3)
// DACH-wide tournament feed, ISR-cached (revalidate = 900 subsumes the Cache-Control ask
// from review-frontend-pwa N4). Valid RSS 2.0, upcoming tournaments ordered by start date.
import { prisma } from '@/lib/db'
import { buildTournamentFeed } from '@/lib/rss'

export const revalidate = 900

async function upcomingTournaments() {
  return prisma.tournament.findMany({
    where: { startDate: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    orderBy: { startDate: 'asc' },
    take: 100,
  })
}

export async function GET() {
  let tournaments
  try {
    tournaments = await upcomingTournaments()
  } catch (err) {
    // Build-time prerendering runs without a database (e.g. local `npm run build` under the
    // no-local-Docker constraint). Serve a valid empty feed there instead of failing the
    // build; runtime revalidation fills in real data within one 15-minute window.
    if (process.env.NEXT_PHASE === 'phase-production-build') {
      return rssResponse(buildTournamentFeed([], {}))
    }
    throw err
  }
  return rssResponse(buildTournamentFeed(tournaments, {}))
}

function rssResponse(xml: string) {
  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  })
}
