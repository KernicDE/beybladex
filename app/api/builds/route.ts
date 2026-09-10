// app/api/builds/route.ts
// GET — public build search as JSON (the deck builder's part-picker consumes this; the /builds
// page itself is server-rendered). Cursor-paginated per the list-endpoint rule. Each result
// carries its Auto-Meta win-rate stats (Phase 5 Part D) from the Redis cache — one batch read
// for the whole page, with direct-compute fallback when the cache is empty.
// Phase 11 (item 6): ?onlyMine=1 requires a session (self-only — no other user's collection is
// exposed by this filter) and restricts results to builds the caller owns all three parts of.
import { auth } from '@/lib/auth'
import { searchBuilds } from '@/lib/buildSearch'
import { getBuildStats } from '@/lib/metaCache'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const q = url.searchParams.get('q') ?? ''
  const cursor = url.searchParams.get('cursor')
  const onlyMine = url.searchParams.get('onlyMine') === '1'

  let onlyMineUserId: string | null = null
  if (onlyMine) {
    const session = await auth()
    if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
    onlyMineUserId = session.user.id
  }

  const { builds, nextCursor } = await searchBuilds({ q, cursor, onlyMineUserId })
  const winRates = await getBuildStats(builds.map((b) => b.id))
  return Response.json(
    {
      builds: builds.map((b) => ({
        id: b.id,
        type: b.type,
        name: b.name,
        isOfficialSet: b.isOfficialSet,
        blade: b.blade,
        ratchet: b.ratchet,
        bit: b.bit,
        winRate: winRates.get(b.id) ?? null,
        ...('available' in b ? { available: b.available } : {}),
      })),
      nextCursor,
    },
    { status: 200 },
  )
}
