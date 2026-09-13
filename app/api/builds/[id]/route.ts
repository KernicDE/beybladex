// app/api/builds/[id]/route.ts (MVP4/4, #144)
// PATCH — Sichtbarkeit eines Builds toggeln (visibility: PUBLIC|UNLISTED). AUTHZ RULE: nur
// die ERSTELLERIN bzw. der Ersteller darf die Sichtbarkeit ändern (Build.creatorId) —
// 401 anonym, 404 für alle anderen inkl. Builds ohne Creator (Vor-MVP4-Rows; Existenz
// wird nicht geleakt, standing not-403/not-leak-Privacy-Policy). Ein Build ist niemals
// geheim: UNLISTED entfernt ihn nur aus den öffentlichen Listungen, der Direktlink bleibt.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const build = await prisma.build.findUnique({ where: { id }, select: { creatorId: true } })
  if (!build || build.creatorId !== session.user.id) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null) return Response.json({ error: 'invalid_body' }, { status: 400 })
  const visibility = (body as { visibility?: unknown }).visibility
  if (visibility !== 'PUBLIC' && visibility !== 'UNLISTED') {
    return Response.json({ error: 'invalid_visibility' }, { status: 400 })
  }

  await prisma.build.update({ where: { id }, data: { visibility } })
  return Response.json({ ok: true, visibility }, { status: 200 })
}
