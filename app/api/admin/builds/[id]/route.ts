// app/api/admin/builds/[id]/route.ts (RC16 #108)
// Curator edit of a single existing Build/Set — the PATCH counterpart of the collection-level
// PATCH in app/api/admin/builds/route.ts (which stays deliberately minimal on productCode).
// Editable here: the retail Set name (nullable — leer lassen heißt "kein kuratierter Name",
// NICHT auf den kanonischen Namen zurücksetzen, das entscheidet die Anzeige-Fallback-Kette)
// und der Bey-Typ. AUTHZ RULE (standing Global-Constraints requirement): the canonical
// curator tier TRUSTED/JUDGE/ORGANIZER/ADMIN (lib/guards.ts requireCurator) — 401 anonymous,
// 403 GUEST/USER. Every successful mutation writes an append-only AuditLog row; rate-limited
// per curator. The image upload lives next door at ./image (POST).
import { requireCurator } from '@/lib/guards'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { parseBody, type BodySchema } from '@/lib/parseBody'

const PATCH_SCHEMA: BodySchema = {
  // Mirrors lib/buildInput.ts's official create-name cap (SET_NAME_MAX = 160).
  name: { type: 'string', trim: true, maxLength: 160, nullable: true, token: 'invalid_name' },
  type: { type: 'enum', enum: ['ATTACK', 'DEFENSE', 'STAMINA', 'BALANCE'], nullable: true, token: 'invalid_type' },
}

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, { params }: Ctx): Promise<Response> {
  const gate = await requireCurator()
  if ('error' in gate) return gate.error
  const { allowed } = await rateLimit(`builds:admin-update:${gate.userId}`, 120, 60 * 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  const { id } = await params
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const { data, errors } = parseBody(body, PATCH_SCHEMA, { partial: true })
  if (errors.length > 0) return Response.json({ error: errors[0], errors }, { status: 400 })

  const existing = await prisma.build.findUnique({ where: { id }, select: { id: true, name: true } })
  if (!existing) return Response.json({ error: 'not_found' }, { status: 404 })
  if (Object.keys(data).length === 0) return Response.json({ error: 'empty_patch' }, { status: 400 })

  const build = await prisma.$transaction(async (tx) => {
    const updated = await tx.build.update({ where: { id }, data })
    await tx.auditLog.create({
      data: {
        actorId: gate.userId,
        action: 'build.update',
        targetType: 'build',
        targetId: updated.id,
        summary: `Build „${existing.name ?? id}“ bearbeitet (${Object.keys(data).join(', ')})`,
      },
    })
    return updated
  })
  return Response.json({ id: build.id, name: build.name, type: build.type }, { status: 200 })
}
