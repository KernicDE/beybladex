// lib/rss.ts (Phase 3)
// RSS 2.0 feed builder for the DACH tournament calendar. Pure function — the feed routes
// query Prisma and hand the rows here. Output is valid RSS 2.0 with GeoRSS points, which
// feed readers parse as normal items.
import type { Tournament } from '@prisma/client'

export interface FeedScope {
  country?: string // e.g. 'de' (lowercase URL segment)
  state?: string // e.g. 'bayern' (lowercase URL segment)
}

const SITE_URL = process.env.NEXTAUTH_URL ?? 'https://beybladex.de'

const COUNTRY_LABELS: Record<string, string> = { DE: 'Deutschland', AT: 'Österreich', CH: 'Schweiz' }

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function channelTitle(scope: FeedScope): string {
  const parts: string[] = []
  if (scope.country) parts.push(COUNTRY_LABELS[scope.country.toUpperCase()] ?? scope.country)
  if (scope.state) parts.push(scope.state)
  return parts.length ? `BeybladeX.de Turniere – ${parts.join(' / ')}` : 'BeybladeX.de Turniere (DACH)'
}

function channelLink(scope: FeedScope): string {
  if (scope.state && scope.country) return `${SITE_URL}/events?country=${encodeURIComponent(scope.country)}&state=${encodeURIComponent(scope.state)}`
  if (scope.country) return `${SITE_URL}/events?country=${encodeURIComponent(scope.country)}`
  return `${SITE_URL}/events`
}

function matchesScope(t: Tournament, scope: FeedScope): boolean {
  if (scope.country && t.country.toLowerCase() !== scope.country.toLowerCase()) return false
  if (scope.state && t.state.toLowerCase() !== scope.state.toLowerCase()) return false
  return true
}

function itemDescription(t: Tournament): string {
  const date = t.startDate.toLocaleDateString('de-DE', { dateStyle: 'medium' })
  const recurring = t.isRecurring && t.recurringDays ? ' (wiederkehrend)' : ''
  return `${t.locationName}, ${t.city} (${t.postalCode}) — ${date}${recurring}`
}

export function buildTournamentFeed(tournaments: Tournament[], scope: FeedScope = {}): string {
  const items = tournaments.filter((t) => matchesScope(t, scope))

  const itemXml = items
    .map((t) => {
      const link = `${SITE_URL}/events/${t.id}`
      return [
        '    <item>',
        `      <title>${escapeXml(t.title)}</title>`,
        `      <link>${escapeXml(link)}</link>`,
        `      <guid isPermaLink="true">${escapeXml(link)}</guid>`,
        `      <pubDate>${t.startDate.toUTCString()}</pubDate>`,
        `      <description>${escapeXml(itemDescription(t))}</description>`,
        t.description ? `      <content:encoded>${escapeXml(t.description)}</content:encoded>` : null,
        `      <georss:point>${t.latitude} ${t.longitude}</georss:point>`,
        '    </item>',
      ]
        .filter((line) => line !== null)
        .join('\n')
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:georss="http://www.georss.org/georss" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>${escapeXml(channelTitle(scope))}</title>
    <link>${escapeXml(channelLink(scope))}</link>
    <description>Bevorstehende Beyblade-X-Turniere${scope.country ? ` in ${escapeXml(COUNTRY_LABELS[scope.country.toUpperCase()] ?? scope.country)}` : ' im DACH-Raum'}</description>
    <language>de</language>
    <generator>beybladex.de</generator>
${itemXml}
  </channel>
</rss>
`
}
