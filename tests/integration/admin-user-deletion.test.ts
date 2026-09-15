// tests/integration/admin-user-deletion.test.ts (issue #185)
// DELETE /api/admin/users/[id]. Integration — CI-only (Postgres/Redis). Covers the standing
// Global-Constraints negative-authz requirement (401/403), the self-deletion refusal (400),
// and the success path: the target is erased/anonymized via the SAME matrix as self-service
// deletion, with the AuditLog row attributed to the ADMIN (actor) and the target (targetId) —
// not the reverse, which is what distinguishes this from an account.delete triggered by the
// user themselves (see lib/accountErasure.ts's actorId/userId split).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { DELETE } from '@/app/api/admin/users/[id]/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

function del(userId: string) {
  return new Request(`http://localhost/api/admin/users/${userId}`, { method: 'DELETE' })
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

describe('admin user deletion', () => {
  afterEach(() => {
    mockAuth.mockReset()
  })

  it('401 unauthenticated; 403 for a non-admin role; the target is untouched', async () => {
    const suffix = Date.now().toString(36)
    const target = await prisma.user.create({ data: { username: `aud_tgt_${suffix}`, passwordHash: 'x', role: 'USER' } })
    const user = await prisma.user.create({ data: { username: `aud_usr_${suffix}`, passwordHash: 'x', role: 'USER' } })

    mockAuth.mockResolvedValue(asSession(null))
    expect((await DELETE(del(target.id), ctx(target.id))).status).toBe(401)

    mockAuth.mockResolvedValue(asSession({ id: user.id, name: user.username }))
    expect((await DELETE(del(target.id), ctx(target.id))).status).toBe(403)

    expect((await prisma.user.findUnique({ where: { id: target.id } }))!.username).toBe(`aud_tgt_${suffix}`)

    await prisma.user.delete({ where: { id: user.id } })
    await prisma.user.delete({ where: { id: target.id } })
  })

  it('an ADMIN cannot delete themselves through this endpoint (400, untouched)', async () => {
    const suffix = Date.now().toString(36)
    const admin = await prisma.user.create({ data: { username: `aud_adm_${suffix}`, passwordHash: 'x', role: 'ADMIN' } })

    mockAuth.mockResolvedValue(asSession({ id: admin.id, name: admin.username }))
    const res = await DELETE(del(admin.id), ctx(admin.id))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('cannot_delete_self')
    expect((await prisma.user.findUnique({ where: { id: admin.id } }))!.username).toBe(`aud_adm_${suffix}`)

    await prisma.user.delete({ where: { id: admin.id } })
  })

  it('a 404 for an unknown user id', async () => {
    const suffix = Date.now().toString(36)
    const admin = await prisma.user.create({ data: { username: `aud_adm_${suffix}`, passwordHash: 'x', role: 'ADMIN' } })

    mockAuth.mockResolvedValue(asSession({ id: admin.id, name: admin.username }))
    const res = await DELETE(del('00000000-0000-0000-0000-000000000000'), ctx('00000000-0000-0000-0000-000000000000'))
    expect(res.status).toBe(404)

    await prisma.user.delete({ where: { id: admin.id } })
  })

  it('an ADMIN can erase another user (204); the target is anonymized AND the AuditLog attributes the admin as actor', async () => {
    const suffix = Date.now().toString(36)
    const admin = await prisma.user.create({ data: { username: `aud_adm_${suffix}`, passwordHash: 'x', role: 'ADMIN' } })
    const target = await prisma.user.create({ data: { username: `aud_tgt_${suffix}`, passwordHash: 'x', role: 'USER', email: 'target@example.com' } })

    mockAuth.mockResolvedValue(asSession({ id: admin.id, name: admin.username }))
    const res = await DELETE(del(target.id), ctx(target.id))
    expect(res.status).toBe(204)

    // Half 1: the same erasure matrix ran — username released/tombstoned, PII gone.
    const erased = await prisma.user.findUnique({ where: { id: target.id } })
    expect(erased).not.toBeNull()
    expect(erased!.username).toBe(`geloescht_${target.id.slice(0, 8)}`)
    expect(erased!.email).toBeNull()
    expect(erased!.status).toBe('ERASED')

    // Half 2: the audit trail attributes the ADMIN as actor (not the deleted user themselves)
    // — this is the behavior this endpoint adds over the pre-existing self-service path.
    const audit = await prisma.auditLog.findFirst({ where: { action: 'account.delete', targetId: target.id } })
    expect(audit).not.toBeNull()
    expect(audit!.actorId).toBe(admin.id)
    expect(audit!.summary).toContain('Admin')

    await prisma.auditLog.delete({ where: { id: audit!.id } })
    await prisma.user.delete({ where: { id: target.id } })
    await prisma.user.delete({ where: { id: admin.id } })
  })
})
