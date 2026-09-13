// app/api/builds/[id]/ratings/route.ts (Phase 5 Part A; MVP4 #141 — polymorphes Rating; #143)
// Legacy-Einstiegspunkt der Build-Bewertungen. Die Implementierung lebt seit MVP4/3 in der
// polymorphen API app/api/ratings/route.ts; dieser Pfad bleibt stabil (bestehende Clients,
// geteilte Links, Integration-Suite) und delegiert mit targetType=BUILD — Verhalten und
// Fehlerformate sind identisch zur polymorphen API.
import {
  GET as GET_RATINGS,
  POST as POST_RATINGS,
  PATCH as PATCH_RATINGS,
  DELETE as DELETE_RATINGS,
} from '@/app/api/ratings/route'

type Ctx = { params: Promise<{ id: string }> }

async function toGeneric(req: Request, buildId: string): Promise<Request> {
  const url = new URL(req.url)
  const qs = new URLSearchParams({ targetType: 'BUILD', targetId: buildId })
  const ratingId = url.searchParams.get('ratingId')
  if (ratingId) qs.set('ratingId', ratingId)
  // Body explizit als Text übernehmen: `new Request(url, req)` übernimmt den Body nicht
  // zuverlässig über Realm-Grenzen (Vitest-VM) — dann würde req.json() im Ziel invalid_json.
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text()
  return new Request(new URL(`/api/ratings?${qs.toString()}`, url.origin), {
    method: req.method,
    headers: req.headers,
    body,
  })
}

export async function GET(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  return GET_RATINGS(await toGeneric(req, id))
}

export async function POST(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  return POST_RATINGS(await toGeneric(req, id))
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  return PATCH_RATINGS(await toGeneric(req, id))
}

export async function DELETE(req: Request, ctx: Ctx) {
  const { id } = await ctx.params
  return DELETE_RATINGS(await toGeneric(req, id))
}
