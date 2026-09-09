// app/api/admin/users/[id]/role/route.ts
// PATCH — set a user's Role (GUEST/USER/TRUSTED/JUDGE/ORGANIZER/ADMIN). AUTHZ RULE (standing
// Global-Constraints requirement): ADMIN-role-only — 401 unauthenticated, 403 for every
// other role (negative test in tests/integration/admin-role-assignment.test.ts). TRUSTED is
// assignable like any other role: it means "trusted catalog contributor" (Phase 5's Part
// curation), not a half-state. Every successful change writes an append-only AuditLog row
// (Phase 4, [REVIEW-FIX: privacy-dsgvo #8]) — the test asserts both halves in one test.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

const ROLES = ['GUEST', 'USER', 'TRUSTED', 'JUDGE', 'ORGANIZER', 'ADMIN'] as const

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const caller = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
  if (caller?.role !== 'ADMIN') {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  const { id } = await params
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, username: true, role: true } })
  if (!target) return Response.json({ error: 'not_found' }, { status: 404 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null || !ROLES.includes((body as Record<string, unknown>).role as (typeof ROLES)[number])) {
    return Response.json({ error: 'invalid_role' }, { status: 400 })
  }
  const role = (body as { role: (typeof ROLES)[number] }).role
  const actorId = session.user.id

  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id: target.id }, data: { role } })
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'user.role_change',
        targetType: 'user',
        targetId: target.id,
        summary: `Rolle von @${target.username} von ${target.role} nach ${role} geändert`,
      },
    })
    return user
  })

  return Response.json({ id: updated.id, role: updated.role }, { status: 200 })
}
