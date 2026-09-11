// tests/unit/notify-radius-perf.test.ts (RC5 issue #44)
// Radius-blast performance contract, seam-mocked on '@/' imports (no real DB/Redis):
//  1. The candidate query is geographically prefiltred in SQL (bounding box) instead of
//     loading every localized user and filtering in JS only.
//  2. The fan-out delivers with bounded concurrency — never one sequential await per user,
//     never an unbounded Promise.all.
// lib/geo's haversineKm is real (pure math) so the exact-distance pass stays under test.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    notification: { create: vi.fn() },
    user: { findMany: vi.fn(), findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/redis', () => ({ redis: { publish: vi.fn() } }))
vi.mock('@/lib/mailer', () => ({ sendNotificationEmail: vi.fn() }))
vi.mock('@/lib/webPush', () => ({ sendPushToUser: vi.fn() }))

import { prisma } from '@/lib/db'
import { notifyUsersInRadius } from '@/lib/notify'

const userFindMany = vi.mocked(prisma.user.findMany)
const notificationCreate = vi.mocked(prisma.notification.create)

// Same geometry as tests/integration/notify-radius.test.ts: Zürich, ~30 km "near" (inside a
// 50 km radius), ~222 km "far" (outside 50 km but inside the 500 km bounding box — exactly
// the row the SQL prefilter must still ship and the JS haversine must then reject).
const TOURNAMENT = {
  id: 't1',
  title: 'Zürich Showdown',
  locationName: 'Spielhalle',
  city: 'Zürich',
  postalCode: '8001',
  startDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
  latitude: 47.3769,
  longitude: 8.5417,
  isRecurring: false,
  createdById: 'organizer',
}

function localizedUser(id: string, lat: number, radiusKm: number) {
  return {
    id,
    latitude: lat,
    longitude: 8.5417,
    notifyRadiusKm: radiusKm,
    notifyRecurring: true,
    notifyEmail: false,
    isMinor: false,
    email: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  notificationCreate.mockImplementation(
    ((args: { data: object }) => Promise.resolve({ id: 'n1', ...args.data })) as typeof notificationCreate
  )
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    notifyEmail: false,
    notifyMatchLifecycle: false,
    notifyMatchLifecycleEmail: false,
    isMinor: false,
    email: null,
  } as never)
})

describe('notifyUsersInRadius (issue #44)', () => {
  it('prefilters candidates with a SQL bounding box instead of a full scan', async () => {
    userFindMany.mockResolvedValue([localizedUser('near', 47.65, 50)] as never)

    await notifyUsersInRadius(TOURNAMENT)

    expect(userFindMany).toHaveBeenCalledTimes(1)
    const query = userFindMany.mock.calls[0][0] as {
      where: {
        latitude: { not: null; gte: number; lte: number }
        longitude: { not: null; gte: number; lte: number }
      }
    }
    // Box around Zürich at the max validated radius (500 km): ±~4.49° lat, ±~7.06° lng.
    expect(query.where.latitude.gte).toBeCloseTo(47.3769 - 500 / 111.32, 3)
    expect(query.where.latitude.lte).toBeCloseTo(47.3769 + 500 / 111.32, 3)
    expect(query.where.longitude.gte).toBeCloseTo(8.5417 - 500 / (111.32 * Math.cos((47.3769 * Math.PI) / 180)), 3)
    expect(query.where.longitude.lte).toBeCloseTo(8.5417 + 500 / (111.32 * Math.cos((47.3769 * Math.PI) / 180)), 3)
    expect(query.where.latitude.not).toBeNull()
    // The organizer never notifies themselves.
    expect((userFindMany.mock.calls[0][0] as { where: { id: { not: string } } }).where.id.not).toBe('organizer')
  })

  it('exact haversine still decides per-user radius (box ships, JS rejects)', async () => {
    userFindMany.mockResolvedValue([
      localizedUser('near', 47.65, 50),
      localizedUser('far', 49.3769, 50), // inside the 500 km box, outside the 50 km radius
    ] as never)

    await notifyUsersInRadius(TOURNAMENT)

    const notified = notificationCreate.mock.calls.map((c) => (c[0] as { data: { userId: string } }).data.userId)
    expect(notified).toEqual(['near'])
  })

  it('fans out with bounded concurrency, not sequentially, not unbounded', async () => {
    const eligible = Array.from({ length: 20 }, (_, i) => localizedUser(`u${i}`, 47.65, 50))
    userFindMany.mockResolvedValue(eligible as never)

    let inFlight = 0
    let maxInFlight = 0
    notificationCreate.mockImplementation((async (args: { data: object }) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      // Small real delay: sequential delivery would stack these; bounded concurrency overlaps them.
      await new Promise((r) => setTimeout(r, 10))
      inFlight -= 1
      return { id: 'n', ...args.data }
    }) as never)

    const start = Date.now()
    await notifyUsersInRadius(TOURNAMENT)
    const elapsed = Date.now() - start

    expect(notificationCreate).toHaveBeenCalledTimes(20)
    expect(maxInFlight).toBeGreaterThan(1) // actually parallel
    expect(maxInFlight).toBeLessThanOrEqual(8) // bounded
    // 20 × 10 ms sequential would be ~200 ms; 8-wide concurrency ~30 ms. Generous ceiling.
    expect(elapsed).toBeLessThan(150)
  })

  it('a failing recipient does not abort the rest of the blast', async () => {
    userFindMany.mockResolvedValue([localizedUser('bad', 47.65, 50), localizedUser('good', 47.65, 50)] as never)
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    notificationCreate.mockImplementation((async (args: { data: { userId: string } }) => {
      if (args.data.userId === 'bad') throw new Error('db down')
      return { id: 'n', ...args.data }
    }) as never)

    await expect(notifyUsersInRadius(TOURNAMENT)).resolves.toBeUndefined()

    const notified = notificationCreate.mock.calls.map((c) => (c[0] as { data: { userId: string } }).data.userId)
    expect(notified.sort()).toEqual(['bad', 'good'])
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
