// app/api/admin/parts/route.ts
// Parts-catalog curation. AUTHZ RULE (standing Global-Constraints requirement): TRUSTED or
// ADMIN role only — 401 unauthenticated, 403 for GUEST/USER/JUDGE/ORGANIZER (negative test in
// tests/integration/parts-admin.test.ts). POST creates a Part, PATCH edits one; every
// successful mutation writes an append-only AuditLog row (Phase 4 model). Rate-limited per user.
import { requireRole } from '@/lib/guards'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { parsePartInput } from '@/lib/partValidation'

async function readJson(req: Request): Promise<unknown | { error: Response }> {
  try {
    return await req.json()
  } catch {
    return { error: Response.json({ error: 'invalid_json' }, { status: 400 }) }
  }
}

export async function POST(req: Request): Promise<Response> {
  // Deliberately narrower than the proposal-reviewer tier until issue #42 lands: TRUSTED/ADMIN.
  const gate = await requireRole('TRUSTED', 'ADMIN')
  if ('error' in gate) return gate.error
  const { allowed } = await rateLimit(`parts:create:${gate.userId}`, 60, 60 * 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  const body = await readJson(req)
  if (body !== null && typeof body === 'object' && 'error' in (body as object)) return (body as { error: Response }).error
  const { data, errors } = parsePartInput(body, false)
  if (errors) return Response.json({ error: errors[0], errors }, { status: 400 })

  const part = await prisma.$transaction(async (tx) => {
    const created = await tx.part.create({ data: data as import('@prisma/client').Prisma.PartCreateInput })
    await tx.auditLog.create({
      data: {
        actorId: gate.userId,
        action: 'part.create',
        targetType: 'part',
        targetId: created.id,
        summary: `Teil „${created.name}“ (${created.category}) angelegt`,
      },
    })
    return created
  })
  return Response.json({ id: part.id }, { status: 201 })
}

export async function PATCH(req: Request): Promise<Response> {
  // Deliberately narrower than the proposal-reviewer tier until issue #42 lands: TRUSTED/ADMIN.
  const gate = await requireRole('TRUSTED', 'ADMIN')
  if ('error' in gate) return gate.error
  const { allowed } = await rateLimit(`parts:update:${gate.userId}`, 120, 60 * 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  const body = await readJson(req)
  if (body !== null && typeof body === 'object' && 'error' in (body as object)) return (body as { error: Response }).error
  const { data, errors } = parsePartInput(body, true)
  if (errors) return Response.json({ error: errors[0], errors }, { status: 400 })

  const id = (body as Record<string, unknown>).id
  if (typeof id !== 'string' || id.length === 0) return Response.json({ error: 'invalid_id' }, { status: 400 })

  const existing = await prisma.part.findUnique({ where: { id }, select: { id: true, name: true } })
  if (!existing) return Response.json({ error: 'not_found' }, { status: 404 })
  if (Object.keys(data!).length === 0) return Response.json({ error: 'empty_patch' }, { status: 400 })

  const part = await prisma.$transaction(async (tx) => {
    const updated = await tx.part.update({ where: { id }, data: data as import('@prisma/client').Prisma.PartUpdateInput })
    await tx.auditLog.create({
      data: {
        actorId: gate.userId,
        action: 'part.update',
        targetType: 'part',
        targetId: updated.id,
        summary: `Teil „${existing.name}“ bearbeitet`,
      },
    })
    return updated
  })
  return Response.json({ id: part.id }, { status: 200 })
}
