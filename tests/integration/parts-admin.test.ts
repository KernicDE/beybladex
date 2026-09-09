// tests/integration/parts-admin.test.ts
// Phase 5 Part A: parts-catalog curation authz. Only TRUSTED/ADMIN can POST/PATCH
// /api/admin/parts and PATCH /api/admin/part-requests — 401 unauthenticated, 403 for USER
// (negative tests, per the standing Global-Constraints rule). A TRUSTED user succeeds and the
// mutation writes an AuditLog row. CI-only (Postgres/Redis).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { POST, PATCH } from '@/app/api/admin/parts/route'
import { PATCH as PATCH_REQUEST } from '@/app/api/admin/part-requests/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

const ids = { users: [] as string[], parts: [] as string[], requests: [] as string[] }

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

async function makeUser(tag: string, role: 'GUEST' | 'USER' | 'TRUSTED' | 'JUDGE' | 'ADMIN') {
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
  for (const id of ids.requests) {
    await prisma.auditLog.deleteMany({ where: { targetId: id } })
    await prisma.partRequest.delete({ where: { id } }).catch(() => {})
  }
  for (const id of ids.users) await prisma.user.delete({ where: { id } }).catch(() => {})
  for (const key of Object.keys(ids)) (ids[key as keyof typeof ids]).length = 0
})

describe('parts catalog curation authz', () => {
  it('POST: 401 unauthenticated; 403 for GUEST/USER/JUDGE; nothing is created', async () => {
    mockAuth.mockResolvedValue(asSession(null))
    expect((await POST(post(VALID_PART))).status).toBe(401)

    for (const role of ['GUEST', 'USER', 'JUDGE'] as const) {
      const user = await makeUser(role.toLowerCase(), role)
      mockAuth.mockResolvedValue(asSession({ id: user.id, name: user.username }))
      expect((await POST(post(VALID_PART))).status).toBe(403)
    }
    expect(await prisma.part.count({ where: { name: `TestBlade 1-60` } })).toBe(0)
    expect(await prisma.auditLog.count({ where: { action: 'part.create' } })).toBe(0)
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

  it('part-requests queue: 403 for USER, TRUSTED can resolve', async () => {
    const suffix = Date.now().toString(36)
    const user = await makeUser('plain', 'USER')
    const trusted = await makeUser('resolver', 'TRUSTED')
    const requester = await makeUser('requester', 'USER')
    const request = await prisma.partRequest.create({
      data: { requestedById: requester.id, name: `Fehlendes Teil ${suffix}`, manufacturerGuess: 'HASBRO' },
    })
    ids.requests.push(request.id)

    const req = () => new Request('http://localhost/api/admin/part-requests', { method: 'PATCH', body: JSON.stringify({ id: request.id, status: 'RESOLVED' }) })
    mockAuth.mockResolvedValue(asSession({ id: user.id, name: user.username }))
    expect((await PATCH_REQUEST(req())).status).toBe(403)
    expect((await prisma.partRequest.findUnique({ where: { id: request.id } }))!.status).toBe('PENDING')

    mockAuth.mockResolvedValue(asSession({ id: trusted.id, name: trusted.username }))
    expect((await PATCH_REQUEST(req())).status).toBe(200)
    expect((await prisma.partRequest.findUnique({ where: { id: request.id } }))!.status).toBe('RESOLVED')
  })
})
