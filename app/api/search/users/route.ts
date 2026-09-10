// app/api/search/users/route.ts (Phase 4)
// GET ?q=&take=&cursor= — username prefix match (case-insensitive), paginated, visibility-
// aware. Read-only and anonymous-accessible (guests get PUBLIC profiles only — see
// lib/userSearch.ts for the documented discoverability rules); abuse protection comes from
// the rate limiter, since a search box is exactly the endpoint a scraper would hammer.
import { auth } from '@/lib/auth'
import { rateLimit } from '@/lib/rateLimit'
import { searchUsers } from '@/lib/userSearch'
import { getClientIp } from '@/lib/getClientIp'

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const session = await auth()
  const viewerId = session?.user?.id ?? null

  const key = viewerId ?? `anon:${getClientIp(req)}` // last XFF hop — spoof-safe bucketing (issue #34)
  const { allowed } = await rateLimit(`search-users:${key}`, 60, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  const params = new URL(req.url).searchParams
  const q = params.get('q') ?? ''
  const take = params.get('take') ? Number.parseInt(params.get('take')!, 10) : undefined
  const cursor = params.get('cursor')

  if (q.trim().length === 0) return Response.json({ users: [], nextCursor: null })

  const result = await searchUsers({ viewerId, q, take, cursor })
  return Response.json(result, { status: 200 })
}
