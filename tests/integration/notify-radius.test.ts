// tests/integration/notify-radius.test.ts
// Phase 3: notifyUsersInRadius radius blast. Integration — needs Postgres/Redis (CI-only,
// never run locally per Global Constraints' no-local-Docker rule).
//
// Covers the plan's acceptance criteria: 3+ seeded users at known distances around a
// tournament (one in-radius, one out, one with notifyRecurring=false on a recurring
// tournament — only the right ones get a Notification row), AND the DSGVO minor rule:
// a minor in-radius user receives the in-app Notification but the email path is skipped
// even with notifyEmail=true (asserted via the mailer spy).
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import type { Tournament, User } from '@prisma/client'
import { prisma } from '@/lib/db'
import { notifyUsersInRadius } from '@/lib/notify'
import { sendNotificationEmail } from '@/lib/mailer'

vi.mock('@/lib/mailer', () => ({ sendNotificationEmail: vi.fn() }))
const mockSend = vi.mocked(sendNotificationEmail)

// All geometry is around Zürich (47.3769, 8.5417):
// - "near"  ≈ 47.65°N  → ~30 km north (inside a 50 km radius)
// - "far"   ≈ 49.38°N  → ~222 km north (outside a 50 km radius)
const TOURNAMENT_POINT = { latitude: 47.3769, longitude: 8.5417 }
const NEAR = { latitude: 47.65, longitude: 8.5417 }
const FAR = { latitude: 49.3769, longitude: 8.5417 }

const suffix = Date.now().toString(36)
const usernames = {
  organizer: `org_${suffix}`,
  nearAdult: `near_${suffix}`,
  farAdult: `far_${suffix}`,
  noRecurring: `norec_${suffix}`,
  minor: `minor_${suffix}`,
}

const userIds: Record<keyof typeof usernames, string> = {} as Record<keyof typeof usernames, string>
let rulesetId: string
let plainTournament: Tournament
let recurringTournament: Tournament

async function makeUser(key: keyof typeof usernames, data: Partial<User>): Promise<User> {
  const user = await prisma.user.create({
    data: {
      username: usernames[key],
      passwordHash: 'x',
      isMinor: false,
      latitude: NEAR.latitude,
      longitude: NEAR.longitude,
      notifyRadiusKm: 50,
      notifyRecurring: true,
      notifyEmail: false,
      ...data,
    },
  })
  userIds[key] = user.id
  return user
}

function makeTournamentData(isRecurring: boolean) {
  return {
    title: isRecurring ? `Wöchentlicher Blader-Abend ${suffix}` : `Zürich Showdown ${suffix}`,
    description: 'Test',
    startDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
    locationName: 'Spielhalle Zürich',
    postalCode: '8001',
    city: 'Zürich',
    state: 'Zürich',
    country: 'CH' as const,
    ...TOURNAMENT_POINT,
    isRecurring,
    rulesetId,
    createdById: userIds.organizer,
  }
}

describe('notifyUsersInRadius', () => {
  beforeAll(async () => {
    await makeUser('organizer', {})
    await makeUser('nearAdult', { notifyEmail: true, email: `near_${suffix}@example.test` })
    await makeUser('farAdult', { ...FAR, notifyEmail: true, email: `far_${suffix}@example.test` })
    await makeUser('noRecurring', { notifyRecurring: false })
    await makeUser('minor', { isMinor: true, notifyEmail: true, email: `minor_${suffix}@example.test`, birthDate: new Date('2014-01-01') })

    const ruleset = await prisma.ruleset.create({
      data: { title: `Notify-Ruleset ${suffix}`, slug: `notify-ruleset-${suffix}`, createdById: userIds.organizer },
    })
    rulesetId = ruleset.id

    plainTournament = await prisma.tournament.create({ data: makeTournamentData(false) })
    recurringTournament = await prisma.tournament.create({ data: makeTournamentData(true) })
  })

  afterAll(async () => {
    const ids = Object.values(userIds)
    await prisma.notification.deleteMany({ where: { userId: { in: ids } } })
    await prisma.tournament.deleteMany({ where: { id: { in: [plainTournament.id, recurringTournament.id] } } })
    await prisma.ruleset.delete({ where: { id: rulesetId } })
    await prisma.user.deleteMany({ where: { id: { in: ids } } })
  })

  it('notifies only users whose own radius covers the tournament; minors get no email', async () => {
    mockSend.mockClear()
    await notifyUsersInRadius(plainTournament)

    const notified = await prisma.notification.findMany({ where: { title: { contains: 'Zürich Showdown' } } })
    const notifiedIds = notified.map((n) => n.userId)

    // In-radius adult: durable row AND email (notifyEmail=true, not a minor).
    expect(notifiedIds).toContain(userIds.nearAdult)
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ to: `near_${suffix}@example.test` }))

    // Out-of-radius adult: nothing at all — no row, no email.
    expect(notifiedIds).not.toContain(userIds.farAdult)
    expect(mockSend).not.toHaveBeenCalledWith(expect.objectContaining({ to: `far_${suffix}@example.test` }))

    // In-radius MINOR: the in-app row IS written, but email is skipped entirely even
    // though notifyEmail=true — the binding DSGVO minor-ceiling rule (privacy-dsgvo #1).
    expect(notifiedIds).toContain(userIds.minor)
    expect(mockSend).not.toHaveBeenCalledWith(expect.objectContaining({ to: `minor_${suffix}@example.test` }))
  })

  it('respects notifyRecurring=false on a recurring tournament', async () => {
    mockSend.mockClear()
    await notifyUsersInRadius(recurringTournament)

    const notified = await prisma.notification.findMany({ where: { title: { contains: 'Wöchentlicher' } } })
    const notifiedIds = notified.map((n) => n.userId)

    // notifyRecurring=false opts out of recurring tournaments entirely.
    expect(notifiedIds).not.toContain(userIds.noRecurring)
    // Everyone else in radius (including the minor — in-app only) still gets it.
    expect(notifiedIds).toContain(userIds.nearAdult)
    expect(notifiedIds).toContain(userIds.minor)
    expect(notifiedIds).not.toContain(userIds.farAdult)
    // Exactly two in-app rows, one email (the in-radius non-minor adult only).
    expect(notified).toHaveLength(2)
    expect(mockSend).toHaveBeenCalledTimes(1)
  })
})
