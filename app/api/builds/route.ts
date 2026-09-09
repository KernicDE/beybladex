// app/api/builds/route.ts
// GET — public build search as JSON (the deck builder's part-picker consumes this; the /builds
// page itself is server-rendered). Cursor-paginated per the list-endpoint rule. Each result
// carries its Auto-Meta win-rate stats (Phase 5 Part D) from the Redis cache — one batch read
// for the whole page, with direct-compute fallback when the cache is empty.
import { searchBuilds } from '@/lib/buildSearch'
import { getBuildStats } from '@/lib/metaCache'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const q = url.searchParams.get('q') ?? ''
  const cursor = url.searchParams.get('cursor')
  const { builds, nextCursor } = await searchBuilds({ q, cursor })
  const winRates = await getBuildStats(builds.map((b) => b.id))
  return Response.json(
    {
      builds: builds.map((b) => ({
        id: b.id,
        type: b.type,
        blade: b.blade,
        ratchet: b.ratchet,
        bit: b.bit,
        winRate: winRates.get(b.id) ?? null,
      })),
      nextCursor,
    },
    { status: 200 },
  )
}
