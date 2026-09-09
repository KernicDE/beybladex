// app/api/builds/route.ts
// GET — public build search as JSON (the deck builder's part-picker consumes this; the /builds
// page itself is server-rendered). Cursor-paginated per the list-endpoint rule.
import { searchBuilds } from '@/lib/buildSearch'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const q = url.searchParams.get('q') ?? ''
  const cursor = url.searchParams.get('cursor')
  const { builds, nextCursor } = await searchBuilds({ q, cursor })
  return Response.json(
    {
      builds: builds.map((b) => ({
        id: b.id,
        type: b.type,
        blade: b.blade,
        ratchet: b.ratchet,
        bit: b.bit,
      })),
      nextCursor,
    },
    { status: 200 },
  )
}
