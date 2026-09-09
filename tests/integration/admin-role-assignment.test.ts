// tests/integration/admin-role-assignment.test.ts
// Phase 4: PATCH /api/admin/users/[id]/role. Integration — CI-only (Postgres/Redis).
// Covers the standing Global-Constraints requirement (negative authz test): only an ADMIN
// session can change another user's role — 401 unauthenticated, 403 for USER and ORGANIZER.
// A successful change (including TO TRUSTED, the "trusted catalog contributor" role) writes an
// append-only AuditLog row — both halves asserted in the same test.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { PATCH } from '@/app/api/admin/users/[id]/role/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

function patchRole(userId: string, role: string) {
  return new Request(`http://localhost/api/admin/users/${userId}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  })
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

describe('admin role assignment', () => {
  afterEach(() => {
    mockAuth.mockReset()
  })

  it('401 unauthenticated; 403 for non-admin roles (USER and ORGANIZER); the target role is untouched', async () => {
    const suffix = Date.now().toString(36)
    const target = await prisma.user.create({ data: { username: `ara_tgt_${suffix}`, passwordHash: 'x', role: 'USER' } })
    const user = await prisma.user.create({ data: { username: `ara_usr_${suffix}`, passwordHash: 'x', role: 'USER' } })
    const organizer = await prisma.user.create({ data: { username: `ara_org_${suffix}`, passwordHash: 'x', role: 'ORGANIZER' } })

    mockAuth.mockResolvedValue(asSession(null))
    expect((await PATCH(patchRole(target.id, 'ADMIN'), ctx(target.id))).status).toBe(401)

    mockAuth.mockResolvedValue(asSession({ id: user.id, name: user.username }))
    expect((await PATCH(patchRole(target.id, 'ADMIN'), ctx(target.id))).status).toBe(403)

    mockAuth.mockResolvedValue(asSession({ id: organizer.id, name: organizer.username }))
    expect((await PATCH(patchRole(target.id, 'ADMIN'), ctx(target.id))).status).toBe(403)

    expect((await prisma.user.findUnique({ where: { id: target.id } }))!.role).toBe('USER')
    expect(await prisma.auditLog.count()).toBe(0)

    await prisma.user.delete({ where: { id: organizer.id } })
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.user.delete({ where: { id: target.id } })
  })

  it('an ADMIN can set any role including TRUSTED, the change applies, AND an AuditLog row is written (both asserted here)', async () => {
    const suffix = Date.now().toString(36)
    const admin = await prisma.user.create({ data: { username: `ara_adm_${suffix}`, passwordHash: 'x', role: 'ADMIN' } })
    const target = await prisma.user.create({ data: { username: `ara_tgt_${suffix}`, passwordHash: 'x', role: 'USER' } })

    mockAuth.mockResolvedValue(asSession({ id: admin.id, name: admin.username }))
    const res = await PATCH(patchRole(target.id, 'TRUSTED'), ctx(target.id))
    expect(res.status).toBe(200)

    // Half 1: the role actually changed.
    const updated = await prisma.user.findUnique({ where: { id: target.id } })
    expect(updated!.role).toBe('TRUSTED')

    // Half 2: the append-only audit trail recorded it, with the ADMIN as actor and the
    // target as target.
    const audit = await prisma.auditLog.findFirst({ where: { action: 'user.role_change', targetId: target.id } })
    expect(audit).not.toBeNull()
    expect(audit!.actorId).toBe(admin.id)
    expect(audit!.targetType).toBe('user')
    expect(audit!.summary).toContain('USER')
    expect(audit!.summary).toContain('TRUSTED')

    await prisma.auditLog.delete({ where: { id: audit!.id } })
    await prisma.user.delete({ where: { id: target.id } })
    await prisma.user.delete({ where: { id: admin.id } })
  })

  it('an unknown role value is 400 and changes nothing', async () => {
    const suffix = Date.now().toString(36)
    const admin = await prisma.user.create({ data: { username: `ara_adm_${suffix}`, passwordHash: 'x', role: 'ADMIN' } })
    const target = await prisma.user.create({ data: { username: `ara_tgt_${suffix}`, passwordHash: 'x', role: 'USER' } })

    mockAuth.mockResolvedValue(asSession({ id: admin.id, name: admin.username }))
    const res = await PATCH(patchRole(target.id, 'SUPERUSER'), ctx(target.id))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_role')
    expect((await prisma.user.findUnique({ where: { id: target.id } }))!.role).toBe('USER')

    await prisma.user.delete({ where: { id: target.id } })
    await prisma.user.delete({ where: { id: admin.id } })
  })
})
