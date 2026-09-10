// app/api/geo/geocode/route.ts (Phase 9)
// GET ?street=&postalCode=&city=&country= — full-address geocoding for the tournament
// form: resolves precise coordinates plus the canonical region once
// street+postalCode+city+country are known. Same Nominatim integration/caching as
// app/api/geo/autocomplete/route.ts.
//
// Authorization rule (documented per Global Constraints): GET is read-only, but requires
// a session — only logged-in organizers' addresses may be forwarded to Nominatim; the
// per-user rate limit below keeps the endpoint from being abused as an open proxy.
import { auth } from '@/lib/auth'
import { rateLimit } from '@/lib/rateLimit'
import { geocodeAddress, type DachCountry } from '@/lib/geo'

export const dynamic = 'force-dynamic'

const COUNTRIES: DachCountry[] = ['DE', 'AT', 'CH']

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { allowed } = await rateLimit(`geo-geocode:${session.user.id}`, 30, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  const params = new URL(req.url).searchParams
  const country = params.get('country') ?? ''
  if (!COUNTRIES.includes(country as DachCountry)) {
    return Response.json({ error: 'invalid_country' }, { status: 400 })
  }

  const suggestion = await geocodeAddress({
    street: params.get('street') ?? '',
    postalCode: params.get('postalCode') ?? '',
    city: params.get('city') ?? '',
    country: country as DachCountry,
  })
  return Response.json({ suggestion }, { status: 200 })
}
