// tests/integration/tournament-start-notifications.test.ts (Phase 18 item 2)
// Integration — CI-only (Postgres/Redis). Starting a tournament (POST /api/tournaments/[id]/start)
// notifies every checked-in, non-withdrawn participant — and NOT a withdrawn or not-checked-in
// one — via the "Turnier gestartet" trigger (lib/notify.ts's notifyTournamentStarted).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { POST as START } from '@/app/api/tournaments/[id]/start/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

function req() {
  return new Request('http://localhost/x/start', { method: 'POST' })
}

afterEach(() => mockAuth.mockReset())

describe('tournament-start notifications', () => {
  it('notifies exactly the checked-in, non-withdrawn participants — not withdrawn or not-checked-in ones', async () => {
    const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const owner = await prisma.user.create({ data: { username: `tsn_ow_${suffix}`, passwordHash: 'x', role: 'ORGANIZER' } })
    const checkedIn = await prisma.user.create({ data: { username: `tsn_in_${suffix}`, passwordHash: 'x' } })
    const notCheckedIn = await prisma.user.create({ data: { username: `tsn_nc_${suffix}`, passwordHash: 'x' } })
    const withdrawn = await prisma.user.create({ data: { username: `tsn_wd_${suffix}`, passwordHash: 'x' } })

    const ruleset = await prisma.ruleset.create({ data: { title: `TSN RS ${suffix}`, slug: `tsn-rs-${suffix}`, createdById: owner.id } })
    const tournament = await prisma.tournament.create({
      data: {
        title: `TSN T ${suffix}`, description: '', startDate: new Date(Date.now() + 86400_000), locationName: 'Arena',
        postalCode: '10115', city: 'Berlin', state: 'Berlin', latitude: 52.52, longitude: 13.405,
        rulesetId: ruleset.id, createdById: owner.id,
      },
    })
    await prisma.tournamentParticipant.create({ data: { tournamentId: tournament.id, userId: checkedIn.id, checkedIn: true } })
    await prisma.tournamentParticipant.create({ data: { tournamentId: tournament.id, userId: notCheckedIn.id, checkedIn: false } })
    await prisma.tournamentParticipant.create({ data: { tournamentId: tournament.id, userId: withdrawn.id, checkedIn: true, withdrawn: true } })

    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    const res = await START(req(), { params: Promise.resolve({ id: tournament.id }) })
    expect(res.status).toBe(200)

    // [REVIEW-FIX] scoped by this tournament's link (not just the three seeded userIds) — a
    // spurious notification to anyone else entirely (e.g. the organizer, who never registered
    // as a participant) would be caught by the exact-count assertion below, not just silently
    // missed by an allow-listed userId filter.
    const notifications = await prisma.notification.findMany({
      where: { title: 'Turnier gestartet', link: `/tournaments/${tournament.id}` },
    })
    expect(notifications).toHaveLength(1)
    const notifiedUserIds = notifications.map((n) => n.userId)
    expect(notifiedUserIds).toEqual([checkedIn.id])
    expect(notifiedUserIds).not.toContain(notCheckedIn.id)
    expect(notifiedUserIds).not.toContain(withdrawn.id)
    expect(notifiedUserIds).not.toContain(owner.id)
  })
})
