// app/api/geo/autocomplete/route.ts (Phase 9)
// GET ?q= — free-text address autocomplete for the tournament form, backed by
// lib/geo.ts's Nominatim integration (Redis-cached, single cluster-wide 1 req/s lock —
// see the OSM usage-policy notes in lib/geo.ts).
//
// Authorization rule (documented per Global Constraints): GET is read-only, but requires
// a session — only a logged-in organizer's keystrokes may be forwarded to Nominatim
// (matching the privacy story documented in /datenschutz); anonymous visitors' input must
// not reach the external service. The per-user rate limit below additionally keeps the
// endpoint from being abused as an open Nominatim proxy.
import { auth } from '@/lib/auth'
import { rateLimit } from '@/lib/rateLimit'
import { searchAddresses } from '@/lib/geo'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { allowed } = await rateLimit(`geo-autocomplete:${session.user.id}`, 30, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  const q = new URL(req.url).searchParams.get('q') ?? ''
  const suggestions = await searchAddresses(q)
  return Response.json({ suggestions }, { status: 200 })
}
