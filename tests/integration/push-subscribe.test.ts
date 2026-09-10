// tests/integration/push-subscribe.test.ts (Phase 18 item 1)
// Integration — CI-only (Postgres/Redis). POST /api/push/subscribe: session-required, upserts
// by endpoint. DELETE /api/push/unsubscribe: session-required AND self-only — a caller can
// never delete another user's subscription row (standing Global-Constraints negative-authz
// requirement).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { POST as SUBSCRIBE } from '@/app/api/push/subscribe/route'
import { DELETE as UNSUBSCRIBE } from '@/app/api/push/unsubscribe/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

function post(body: unknown) {
  return new Request('http://localhost/api/push/subscribe', { method: 'POST', body: JSON.stringify(body) })
}
function del(body: unknown) {
  return new Request('http://localhost/api/push/unsubscribe', { method: 'DELETE', body: JSON.stringify(body) })
}

const ids = { users: [] as string[], endpoints: [] as string[] }

afterEach(async () => {
  mockAuth.mockReset()
  await prisma.pushSubscription.deleteMany({ where: { endpoint: { in: ids.endpoints } } })
  for (const id of ids.users) await prisma.user.delete({ where: { id } }).catch(() => {})
  ids.users.length = 0
  ids.endpoints.length = 0
})

describe('push subscribe/unsubscribe', () => {
  it('POST requires a session (401 anonymous)', async () => {
    mockAuth.mockResolvedValue(asSession(null))
    const res = await SUBSCRIBE(post({ endpoint: 'https://push.example/x', keys: { p256dh: 'a', auth: 'b' } }))
    expect(res.status).toBe(401)
  })

  it('POST upserts by endpoint and stores the subscription', async () => {
    const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const user = await prisma.user.create({ data: { username: `push_${suffix}`, passwordHash: 'x' } })
    ids.users.push(user.id)
    const endpoint = `https://push.example/${suffix}`
    ids.endpoints.push(endpoint)

    mockAuth.mockResolvedValue(asSession({ id: user.id, name: user.username }))
    const first = await SUBSCRIBE(post({ endpoint, keys: { p256dh: 'p1', auth: 'a1' } }))
    expect(first.status).toBe(201)

    // Re-subscribing under the same endpoint updates in place, not a second row.
    const second = await SUBSCRIBE(post({ endpoint, keys: { p256dh: 'p2', auth: 'a2' } }))
    expect(second.status).toBe(201)

    const rows = await prisma.pushSubscription.findMany({ where: { endpoint } })
    expect(rows).toHaveLength(1)
    expect(rows[0].p256dh).toBe('p2')
    expect(rows[0].userId).toBe(user.id)
  })

  it('DELETE requires a session (401 anonymous)', async () => {
    mockAuth.mockResolvedValue(asSession(null))
    const res = await UNSUBSCRIBE(del({ endpoint: 'https://push.example/x' }))
    expect(res.status).toBe(401)
  })

  it("DELETE is self-only: a caller cannot delete another user's subscription", async () => {
    const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const owner = await prisma.user.create({ data: { username: `push_own_${suffix}`, passwordHash: 'x' } })
    const attacker = await prisma.user.create({ data: { username: `push_atk_${suffix}`, passwordHash: 'x' } })
    ids.users.push(owner.id, attacker.id)
    const endpoint = `https://push.example/self-only-${suffix}`
    ids.endpoints.push(endpoint)
    await prisma.pushSubscription.create({ data: { userId: owner.id, endpoint, p256dh: 'p', auth: 'a' } })

    mockAuth.mockResolvedValue(asSession({ id: attacker.id, name: attacker.username }))
    const res = await UNSUBSCRIBE(del({ endpoint }))
    // No ownership confirmed/denied distinction — deleteMany just matches nothing (204).
    expect(res.status).toBe(204)
    const stillThere = await prisma.pushSubscription.findUnique({ where: { endpoint } })
    expect(stillThere).not.toBeNull()
    expect(stillThere?.userId).toBe(owner.id)

    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    const ownRes = await UNSUBSCRIBE(del({ endpoint }))
    expect(ownRes.status).toBe(204)
    const gone = await prisma.pushSubscription.findUnique({ where: { endpoint } })
    expect(gone).toBeNull()
  })
})
