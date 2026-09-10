// tests/integration/parts-admin.test.ts
// Phase 5 Part A: parts-catalog curation authz. The canonical curator tier
// TRUSTED/JUDGE/ORGANIZER/ADMIN (lib/roles.ts CURATOR_ROLES, issue #42 — the old hardcoded
// TRUSTED/ADMIN list that 403'd JUDGE/ORGANIZER is gone) can POST/PATCH /api/admin/parts —
// 401 unauthenticated, 403 for GUEST/USER (negative tests, per the standing Global-Constraints
// rule). A TRUSTED user succeeds and the mutation writes an AuditLog row.
// The old "part-requests queue" test below was removed — PartRequest was replaced by
// CatalogProposal in Phase 11; see tests/integration/catalog-proposal-flow.test.ts.
// CI-only (Postgres/Redis).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { POST, PATCH } from '@/app/api/admin/parts/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

const ids = { users: [] as string[], parts: [] as string[] }

const VALID_PART = {
  name: 'TestBlade 1-60',
  manufacturer: 'TT',
  category: 'BLADE',
  beyType: 'ATTACK',
  spinDirection: 'RIGHT',
  weightGrams: 32.5,
  imageUrl: null,
  metadata: null,
}

function post(body: unknown) {
  return new Request('http://localhost/api/admin/parts', { method: 'POST', body: JSON.stringify(body) })
}

async function makeUser(tag: string, role: 'GUEST' | 'USER' | 'TRUSTED' | 'JUDGE' | 'ORGANIZER' | 'ADMIN') {
  const suffix = Date.now().toString(36)
  const user = await prisma.user.create({ data: { username: `pa_${tag}_${suffix}`, passwordHash: 'x', role } })
  ids.users.push(user.id)
  return user
}

afterEach(() => mockAuth.mockReset())
afterEach(async () => {
  for (const id of ids.parts) {
    await prisma.auditLog.deleteMany({ where: { targetId: id } })
    await prisma.part.delete({ where: { id } }).catch(() => {})
  }
  for (const id of ids.users) await prisma.user.delete({ where: { id } }).catch(() => {})
  for (const key of Object.keys(ids)) (ids[key as keyof typeof ids]).length = 0
})

describe('parts catalog curation authz', () => {
  it('POST: 401 unauthenticated; 403 for GUEST/USER; nothing is created', async () => {
    mockAuth.mockResolvedValue(asSession(null))
    expect((await POST(post(VALID_PART))).status).toBe(401)

    for (const role of ['GUEST', 'USER'] as const) {
      const user = await makeUser(role.toLowerCase(), role)
      mockAuth.mockResolvedValue(asSession({ id: user.id, name: user.username }))
      expect((await POST(post(VALID_PART))).status).toBe(403)
    }
    expect(await prisma.part.count({ where: { name: `TestBlade 1-60` } })).toBe(0)
    expect(await prisma.auditLog.count({ where: { action: 'part.create' } })).toBe(0)
  })

  it('issue #42: the full curator tier TRUSTED/JUDGE/ORGANIZER/ADMIN can POST (no more drift)', async () => {
    for (const role of ['TRUSTED', 'JUDGE', 'ORGANIZER', 'ADMIN'] as const) {
      const user = await makeUser(role.toLowerCase(), role)
      mockAuth.mockResolvedValue(asSession({ id: user.id, name: user.username }))
      const res = await POST(post({ ...VALID_PART, name: `TestBlade 1-60 ${role}` }))
      expect(res.status, `role ${role} must be allowed`).toBe(201)
      const { id } = (await res.json()) as { id: string }
      ids.parts.push(id)
    }
    expect(await prisma.part.count({ where: { name: { startsWith: 'TestBlade 1-60' } } })).toBe(4)
    expect(await prisma.auditLog.count({ where: { action: 'part.create' } })).toBe(4)
  })

  it('TRUSTED can POST a part (201 + AuditLog row); ADMIN can PATCH it', async () => {
    const trusted = await makeUser('trusted', 'TRUSTED')
    const admin = await makeUser('admin', 'ADMIN')

    mockAuth.mockResolvedValue(asSession({ id: trusted.id, name: trusted.username }))
    const created = await POST(post(VALID_PART))
    expect(created.status).toBe(201)
    const { id } = (await created.json()) as { id: string }
    ids.parts.push(id)
    expect(await prisma.auditLog.count({ where: { action: 'part.create', targetId: id, actorId: trusted.id } })).toBe(1)

    mockAuth.mockResolvedValue(asSession({ id: admin.id, name: admin.username }))
    const patched = await PATCH(
      new Request('http://localhost/api/admin/parts', { method: 'PATCH', body: JSON.stringify({ id, weightGrams: 33.1 }) }),
    )
    expect(patched.status).toBe(200)
    expect((await prisma.part.findUnique({ where: { id } }))!.weightGrams).toBe(33.1)
  })

})
