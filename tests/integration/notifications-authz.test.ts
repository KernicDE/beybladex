// tests/integration/notifications-authz.test.ts
// Phase 3: notification inbox API authorization. Integration — needs Postgres/Redis
// (CI-only, never run locally per Global Constraints' no-local-Docker rule).
//
// Authorization rule under test: GET/PATCH /api/notifications are scoped to the session
// user; a request naming ANOTHER user's notification id returns 404, never that user's
// data ([REVIEW-FIX: backend-security #21]). Also covers the internal cleanup route's
// shared-secret protection and the retention periods.
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { GET, PATCH } from '@/app/api/notifications/route'
import { POST as CLEANUP_POST } from '@/app/api/internal/cleanup-notifications/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

describe('GET/PATCH /api/notifications (owner-scoped)', () => {
  const suffix = Date.now().toString(36)
  const names = { a: `nota_${suffix}`, b: `notb_${suffix}` }
  let idA: string
  let idB: string
  let notifA: string
  let notifB: string

  beforeAll(async () => {
    const a = await prisma.user.create({ data: { username: names.a, passwordHash: 'x', isMinor: false } })
    const b = await prisma.user.create({ data: { username: names.b, passwordHash: 'x', isMinor: false } })
    idA = a.id
    idB = b.id
    notifA = (await prisma.notification.create({ data: { userId: idA, title: 'Eigenes Turnier', message: 'x' } })).id
    notifB = (await prisma.notification.create({ data: { userId: idB, title: 'Fremdes Turnier', message: 'y' } })).id
  })

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId: { in: [idA, idB] } } })
    await prisma.user.deleteMany({ where: { id: { in: [idA, idB] } } })
  })

  beforeEach(() => {
    mockAuth.mockResolvedValue(asSession({ id: idA, name: names.a }))
  })

  afterEach(() => {
    mockAuth.mockReset()
  })

  it('GET lists only the caller\'s own notifications', async () => {
    const res = await GET(new Request('http://localhost/api/notifications'))
    expect(res.status).toBe(200)
    const body = await res.json()
    const ids = body.notifications.map((n: { id: string }) => n.id)
    expect(ids).toContain(notifA)
    expect(ids).not.toContain(notifB)
  })

  it('GET returns 401 without a session', async () => {
    mockAuth.mockResolvedValue(asSession(null))
    const res = await GET(new Request('http://localhost/api/notifications'))
    expect(res.status).toBe(401)
  })

  it('PATCH with another user\'s notification id returns 404 and changes nothing', async () => {
    const res = await PATCH(new Request('http://localhost/api/notifications', {
      method: 'PATCH',
      body: JSON.stringify({ ids: [notifB] }),
    }))
    expect(res.status).toBe(404)
    const untouched = await prisma.notification.findUnique({ where: { id: notifB } })
    expect(untouched!.isRead).toBe(false)
  })

  it('PATCH refuses a mixed list containing a foreign id (no partial writes)', async () => {
    const res = await PATCH(new Request('http://localhost/api/notifications', {
      method: 'PATCH',
      body: JSON.stringify({ ids: [notifA, notifB] }),
    }))
    expect(res.status).toBe(404)
    const own = await prisma.notification.findUnique({ where: { id: notifA } })
    expect(own!.isRead).toBe(false) // own row NOT marked despite being in the list
  })

  it('PATCH { markAllRead: true } only touches the caller\'s rows', async () => {
    const res = await PATCH(new Request('http://localhost/api/notifications', {
      method: 'PATCH',
      body: JSON.stringify({ markAllRead: true }),
    }))
    expect(res.status).toBe(200)
    const own = await prisma.notification.findUnique({ where: { id: notifA } })
    const foreign = await prisma.notification.findUnique({ where: { id: notifB } })
    expect(own!.isRead).toBe(true)
    expect(foreign!.isRead).toBe(false)
    // reset for the next test run
    await prisma.notification.update({ where: { id: notifA }, data: { isRead: false } })
  })

  it('PATCH returns 401 without a session', async () => {
    mockAuth.mockResolvedValue(asSession(null))
    const res = await PATCH(new Request('http://localhost/api/notifications', {
      method: 'PATCH',
      body: JSON.stringify({ markAllRead: true }),
    }))
    expect(res.status).toBe(401)
  })
})

describe('POST /api/internal/cleanup-notifications (shared-secret protected)', () => {
  const suffix2 = `${Date.now().toString(36)}c`
  let userId: string

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { username: `cln_${suffix2}`, passwordHash: 'x' } })
    userId = user.id
  })

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId } })
    await prisma.user.delete({ where: { id: userId } })
    delete process.env.INTERNAL_CRON_SECRET
  })

  it('rejects requests without (or with a wrong) x-cron-secret', async () => {
    process.env.INTERNAL_CRON_SECRET = 'test-cron-secret'
    const noHeader = await CLEANUP_POST(new Request('http://localhost/api/internal/cleanup-notifications', { method: 'POST' }))
    expect(noHeader.status).toBe(401)
    const wrong = await CLEANUP_POST(new Request('http://localhost/api/internal/cleanup-notifications', {
      method: 'POST',
      headers: { 'x-cron-secret': 'attacker-guess' },
    }))
    expect(wrong.status).toBe(401)
  })

  it('purges read rows older than 90 days and unread rows older than 12 months', async () => {
    process.env.INTERNAL_CRON_SECRET = 'test-cron-secret'
    const now = Date.now()
    const day = 24 * 60 * 60 * 1000
    const oldRead = await prisma.notification.create({
      data: { userId, title: 'old read', message: 'x', isRead: true, createdAt: new Date(now - 100 * day) },
    })
    const oldUnread = await prisma.notification.create({
      data: { userId, title: 'old unread', message: 'x', isRead: false, createdAt: new Date(now - 400 * day) },
    })
    const freshRead = await prisma.notification.create({
      data: { userId, title: 'fresh read', message: 'x', isRead: true, createdAt: new Date(now - 10 * day) },
    })

    const res = await CLEANUP_POST(new Request('http://localhost/api/internal/cleanup-notifications', {
      method: 'POST',
      headers: { 'x-cron-secret': 'test-cron-secret' },
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.deleted).toBeGreaterThanOrEqual(2)

    expect(await prisma.notification.findUnique({ where: { id: oldRead.id } })).toBeNull()
    expect(await prisma.notification.findUnique({ where: { id: oldUnread.id } })).toBeNull()
    expect(await prisma.notification.findUnique({ where: { id: freshRead.id } })).not.toBeNull()
  })
})
