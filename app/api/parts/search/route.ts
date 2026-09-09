// app/api/parts/search/route.ts
// Public parts-catalog search as JSON (Phase 5 Part B) — the collection form's part-picker
// consumes this, same as the deck builder consumes GET /api/builds. The catalog itself is
// public; cursor-paginated per the list-endpoint rule.
import { searchParts } from '@/lib/buildSearch'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const q = url.searchParams.get('q') ?? ''
  const category = url.searchParams.get('category') ?? undefined
  const cursor = url.searchParams.get('cursor')
  const { parts, nextCursor } = await searchParts({ q, category, cursor })
  return Response.json({ parts, nextCursor }, { status: 200 })
}
