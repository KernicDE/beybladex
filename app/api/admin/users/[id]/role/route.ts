// app/api/admin/users/[id]/role/route.ts
// PATCH — set a user's trust-tier Role (GUEST/USER/TRUSTED/ADMIN) and/or the additive
// isJudge/isOrganizer capabilities (issue #199 follow-up: Judge and Organizer are independent
// of the trust ladder — someone can be TRUSTED+isJudge+isOrganizer, USER+isOrganizer, etc.).
// AUTHZ RULE (standing Global-Constraints requirement): ADMIN-role-only — 401 unauthenticated,
// 403 for every other role (negative test in tests/integration/admin-role-assignment.test.ts).
// TRUSTED is assignable like any other role: it means "trusted catalog contributor" (Phase 5's
// Part curation), not a half-state. Every successful change writes an append-only AuditLog row
// (Phase 4, [REVIEW-FIX: privacy-dsgvo #8]) — the test asserts both halves in one test.
import { requireAdmin } from '@/lib/guards'
import { prisma } from '@/lib/db'

// JUDGE/ORGANIZER are deliberately absent — those Role enum values are backward-compat-only
// DB leftovers (see the 20260915150000 migration); new writes must use isJudge/isOrganizer.
const ROLES = ['GUEST', 'USER', 'TRUSTED', 'ADMIN'] as const

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: Request, { params }: Ctx) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const { id } = await params
  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, username: true, role: true, isJudge: true, isOrganizer: true },
  })
  if (!target) return Response.json({ error: 'not_found' }, { status: 404 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null) {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }
  const { role, isJudge, isOrganizer } = body as { role?: unknown; isJudge?: unknown; isOrganizer?: unknown }

  const data: { role?: (typeof ROLES)[number]; isJudge?: boolean; isOrganizer?: boolean } = {}
  if (role !== undefined) {
    if (!ROLES.includes(role as (typeof ROLES)[number])) {
      return Response.json({ error: 'invalid_role' }, { status: 400 })
    }
    data.role = role as (typeof ROLES)[number]
  }
  if (isJudge !== undefined) {
    if (typeof isJudge !== 'boolean') return Response.json({ error: 'invalid_is_judge' }, { status: 400 })
    data.isJudge = isJudge
  }
  if (isOrganizer !== undefined) {
    if (typeof isOrganizer !== 'boolean') return Response.json({ error: 'invalid_is_organizer' }, { status: 400 })
    data.isOrganizer = isOrganizer
  }
  if (Object.keys(data).length === 0) {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }

  const actorId = gate.userId
  const summaryParts: string[] = []
  if (data.role !== undefined) summaryParts.push(`Rolle von ${target.role} nach ${data.role}`)
  if (data.isJudge !== undefined) summaryParts.push(`isJudge von ${target.isJudge} nach ${data.isJudge}`)
  if (data.isOrganizer !== undefined) summaryParts.push(`isOrganizer von ${target.isOrganizer} nach ${data.isOrganizer}`)

  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id: target.id }, data })
    await tx.auditLog.create({
      data: {
        actorId,
        action: 'user.role_change',
        targetType: 'user',
        targetId: target.id,
        summary: `@${target.username}: ${summaryParts.join('; ')} geändert`,
      },
    })
    return user
  })

  return Response.json({ id: updated.id, role: updated.role, isJudge: updated.isJudge, isOrganizer: updated.isOrganizer }, { status: 200 })
}
