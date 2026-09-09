// app/api/admin/part-requests/route.ts
// PATCH — resolve or reject an entry in the "request missing part" queue. AUTHZ RULE: same as
// the parts catalog itself, TRUSTED/ADMIN only (401/403 — negative test in
// tests/integration/parts-admin.test.ts). Writes an append-only AuditLog row per Phase 4.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

const STATUSES = ['RESOLVED', 'REJECTED'] as const

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const caller = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
  if (caller?.role !== 'TRUSTED' && caller?.role !== 'ADMIN') {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const b = body as Record<string, unknown>
  if (typeof b !== 'object' || b === null || typeof b.id !== 'string' || !STATUSES.includes(b.status as (typeof STATUSES)[number])) {
    return Response.json({ error: 'invalid_input' }, { status: 400 })
  }

  const existing = await prisma.partRequest.findUnique({ where: { id: b.id }, select: { id: true, name: true } })
  if (!existing) return Response.json({ error: 'not_found' }, { status: 404 })

  const status = b.status as (typeof STATUSES)[number]
  const actorId = session.user.id
  await prisma.$transaction(async (tx) => {
    await tx.partRequest.update({ where: { id: existing.id }, data: { status } })
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'part_request.update',
        targetType: 'part_request',
        targetId: existing.id,
        summary: `Teil-Anfrage „${existing.name}“ als ${status} markiert`,
      },
    })
  })
  return Response.json({ id: existing.id, status }, { status: 200 })
}
