// tests/unit/notify-triggers.test.ts (Phase 18 item 2)
// Each new trigger function calls notifyUser with the right recipients — asserted via the
// Notification row every notifyUser call creates (prisma.notification.create is the one write
// every notification path goes through regardless of channel, so it's the cleanest spy point).
// @/lib/db is mocked (same "mock the DB, assert the query" pattern as
// tests/unit/friendship-batch.test.ts) — genuinely a unit test despite touching Prisma-shaped
// call sites, since nothing here hits a real database.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    notification: { create: vi.fn() },
    user: { findUnique: vi.fn() },
    tournament: { findUnique: vi.fn() },
    tournamentParticipant: { findMany: vi.fn() },
    match: { findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/redis', () => ({ redis: { publish: vi.fn() } }))
vi.mock('@/lib/mailer', () => ({ sendNotificationEmail: vi.fn() }))
vi.mock('@/lib/webPush', () => ({ sendPushToUser: vi.fn() }))

import { prisma } from '@/lib/db'
import { notifyTournamentStarted, notifyArenaAssigned, notifyMatchReady } from '@/lib/notify'

const notificationCreate = vi.mocked(prisma.notification.create)
const userFindUnique = vi.mocked(prisma.user.findUnique)
const tournamentFindUnique = vi.mocked(prisma.tournament.findUnique)
const participantFindMany = vi.mocked(prisma.tournamentParticipant.findMany)
const matchFindUnique = vi.mocked(prisma.match.findUnique)

function fakeUser() {
  return { notifyEmail: false, notifyMatchLifecycle: true, notifyMatchLifecycleEmail: false, isMinor: false, email: null }
}

beforeEach(() => {
  vi.clearAllMocks()
  notificationCreate.mockImplementation(((args: { data: object }) => Promise.resolve({ id: 'n', ...args.data })) as typeof notificationCreate)
  userFindUnique.mockResolvedValue(fakeUser() as never)
})

describe('notifyTournamentStarted', () => {
  it('notifies exactly the checked-in, non-withdrawn participants — nobody else', async () => {
    tournamentFindUnique.mockResolvedValue({ title: 'Herbstcup' } as never)
    participantFindMany.mockResolvedValue([{ userId: 'p1' }, { userId: 'p2' }] as never)

    await notifyTournamentStarted('t1')

    // The query itself must filter to checked-in + non-withdrawn (the mock only returns what
    // it's told to, but asserting the where-clause catches a regression that drops the filter).
    expect(participantFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tournamentId: 't1', checkedIn: true, withdrawn: false } })
    )
    const recipients = notificationCreate.mock.calls.map((c) => (c[0] as { data: { userId: string } }).data.userId)
    expect(recipients.sort()).toEqual(['p1', 'p2'])
    expect(notificationCreate.mock.calls[0][0]).toMatchObject({ data: { title: 'Turnier gestartet' } })
  })
})

describe('notifyArenaAssigned', () => {
  it('notifies exactly the two match players, not the whole tournament', async () => {
    matchFindUnique.mockResolvedValue({ player1Id: 'a', player2Id: 'b', tournamentId: 't1' } as never)

    await notifyArenaAssigned('m1', 3)

    const recipients = notificationCreate.mock.calls.map((c) => (c[0] as { data: { userId: string } }).data.userId)
    expect(recipients.sort()).toEqual(['a', 'b'])
    expect(notificationCreate.mock.calls[0][0]).toMatchObject({ data: { title: 'Gehe zu Arena 3' } })
  })

  it('a bye match (one null player) notifies only the real player', async () => {
    matchFindUnique.mockResolvedValue({ player1Id: 'a', player2Id: null, tournamentId: 't1' } as never)

    await notifyArenaAssigned('m1', 1)

    const recipients = notificationCreate.mock.calls.map((c) => (c[0] as { data: { userId: string } }).data.userId)
    expect(recipients).toEqual(['a'])
  })
})

describe('notifyMatchReady', () => {
  it('notifies both players when a PENDING match has both resolved', async () => {
    matchFindUnique.mockResolvedValue({ status: 'PENDING', player1Id: 'a', player2Id: 'b', tournamentId: 't1', arenaNumber: null } as never)

    await notifyMatchReady('m1')

    const recipients = notificationCreate.mock.calls.map((c) => (c[0] as { data: { userId: string } }).data.userId)
    expect(recipients.sort()).toEqual(['a', 'b'])
    // No arena assigned yet — only the "ready" notification, never a "Gehe zu Arena" one.
    expect(notificationCreate.mock.calls.every((c) => (c[0] as { data: { title: string } }).data.title === 'Dein nächstes Match beginnt')).toBe(true)
  })

  it('is a no-op when only one player is set yet', async () => {
    matchFindUnique.mockResolvedValue({ status: 'PENDING', player1Id: 'a', player2Id: null, tournamentId: 't1', arenaNumber: null } as never)

    await notifyMatchReady('m1')

    expect(notificationCreate).not.toHaveBeenCalled()
  })

  it('is a no-op when the match is not PENDING (e.g. already IN_PROGRESS from a replay)', async () => {
    matchFindUnique.mockResolvedValue({ status: 'IN_PROGRESS', player1Id: 'a', player2Id: 'b', tournamentId: 't1', arenaNumber: null } as never)

    await notifyMatchReady('m1')

    expect(notificationCreate).not.toHaveBeenCalled()
  })

  // [REVIEW-FIX P18-1 regression] the generation-time arena pass can assign an arena to a match
  // that has no players yet (later elimination rounds) — notifyArenaAssigned's null-player
  // filter drops that case silently and nothing else ever re-fires it. notifyMatchReady's
  // combined read closes the gap: once both players ARE resolved, if the match already carries
  // a non-null arenaNumber, both "ready" AND "arena" notifications fire together.
  it('also fires "Gehe zu Arena N" when the now-ready match already has an arena assigned', async () => {
    matchFindUnique.mockResolvedValue({ status: 'PENDING', player1Id: 'a', player2Id: 'b', tournamentId: 't1', arenaNumber: 2 } as never)

    await notifyMatchReady('m1')

    const calls = notificationCreate.mock.calls.map((c) => (c[0] as { data: { userId: string; title: string } }).data)
    expect(calls.filter((c) => c.title === 'Dein nächstes Match beginnt').map((c) => c.userId).sort()).toEqual(['a', 'b'])
    expect(calls.filter((c) => c.title === 'Gehe zu Arena 2').map((c) => c.userId).sort()).toEqual(['a', 'b'])
  })
})

describe('matchLifecycle category routing (email + push toggles)', () => {
  // [REVIEW-FIX] closes a real test blind spot: fakeUser() previously always had
  // notifyMatchLifecycleEmail: false, so a regression that routed matchLifecycle email back
  // through the blanket notifyEmail (the exact thing this phase separated) would have passed
  // silently. Same for push: the toggle being ignored (pushing to everyone) was never asserted.
  const sendNotificationEmailMock = () => import('@/lib/mailer').then((m) => vi.mocked(m.sendNotificationEmail))
  const sendPushToUserMock = () => import('@/lib/webPush').then((m) => vi.mocked(m.sendPushToUser))

  it('emails only when notifyMatchLifecycleEmail is true, independent of notifyEmail', async () => {
    userFindUnique.mockResolvedValue({ notifyEmail: true, notifyMatchLifecycle: true, notifyMatchLifecycleEmail: false, isMinor: false, email: 'a@example.com' } as never)
    matchFindUnique.mockResolvedValue({ status: 'PENDING', player1Id: 'a', player2Id: 'b', tournamentId: 't1', arenaNumber: null } as never)
    const sendEmail = await sendNotificationEmailMock()

    await notifyMatchReady('m1')

    // notifyEmail: true is IGNORED for this category — only notifyMatchLifecycleEmail governs.
    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('emails when notifyMatchLifecycleEmail is explicitly true', async () => {
    userFindUnique.mockResolvedValue({ notifyEmail: false, notifyMatchLifecycle: true, notifyMatchLifecycleEmail: true, isMinor: false, email: 'a@example.com' } as never)
    matchFindUnique.mockResolvedValue({ status: 'PENDING', player1Id: 'a', player2Id: 'b', tournamentId: 't1', arenaNumber: null } as never)
    const sendEmail = await sendNotificationEmailMock()

    await notifyMatchReady('m1')

    expect(sendEmail).toHaveBeenCalled()
  })

  it('never emails an isMinor user even with notifyMatchLifecycleEmail: true', async () => {
    userFindUnique.mockResolvedValue({ notifyEmail: false, notifyMatchLifecycle: true, notifyMatchLifecycleEmail: true, isMinor: true, email: 'a@example.com' } as never)
    matchFindUnique.mockResolvedValue({ status: 'PENDING', player1Id: 'a', player2Id: 'b', tournamentId: 't1', arenaNumber: null } as never)
    const sendEmail = await sendNotificationEmailMock()

    await notifyMatchReady('m1')

    expect(sendEmail).not.toHaveBeenCalled()
  })

  it('pushes only when notifyMatchLifecycle is true', async () => {
    userFindUnique.mockResolvedValue({ notifyEmail: false, notifyMatchLifecycle: false, notifyMatchLifecycleEmail: false, isMinor: false, email: null } as never)
    matchFindUnique.mockResolvedValue({ status: 'PENDING', player1Id: 'a', player2Id: 'b', tournamentId: 't1', arenaNumber: null } as never)
    const sendPush = await sendPushToUserMock()

    await notifyMatchReady('m1')

    expect(sendPush).not.toHaveBeenCalled()
  })

  it('pushes when notifyMatchLifecycle is true', async () => {
    userFindUnique.mockResolvedValue({ notifyEmail: false, notifyMatchLifecycle: true, notifyMatchLifecycleEmail: false, isMinor: false, email: null } as never)
    matchFindUnique.mockResolvedValue({ status: 'PENDING', player1Id: 'a', player2Id: 'b', tournamentId: 't1', arenaNumber: null } as never)
    const sendPush = await sendPushToUserMock()

    await notifyMatchReady('m1')

    expect(sendPush).toHaveBeenCalledTimes(2) // both players
  })
})
