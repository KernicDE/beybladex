// tests/integration/decklock-sweep.test.ts (Issue #181 — "Decklock")
// Integration — needs Postgres/Redis (CI-only, never run locally per Global Constraints' no-
// local-Docker rule). Covers both jobs runDecklockSweep does in one pass: the 24h-reminder and
// the past-lock removal, plus the negative case (a participant who already has a deck is
// untouched either way).
import { describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/db'
import { runDecklockSweep } from '@/lib/decklockSweep'

// Nicht auf konkrete E-Mail-Inhalte geprüft (das macht tests/integration/notify-radius.test.ts
// bereits ausführlich) — nur gemockt, damit ein echter SMTP-Versand in CI nie versucht wird.
vi.mock('@/lib/mailer', () => ({ sendNotificationEmail: vi.fn() }))

async function makeTournament(suffix: string, overrides: { deckLockAt?: Date | null; startDate?: Date } = {}) {
  const organizer = await prisma.user.create({ data: { username: `dls_org_${suffix}`, passwordHash: 'x', role: 'ORGANIZER' } })
  const ruleset = await prisma.ruleset.create({ data: { title: `dls_rs_${suffix}`, slug: `dls-rs-${suffix}`, createdById: organizer.id } })
  const tournament = await prisma.tournament.create({
    data: {
      title: `dls_t_${suffix}`,
      description: '',
      startDate: overrides.startDate ?? new Date(Date.now() + 48 * 60 * 60 * 1000),
      deckLockAt: overrides.deckLockAt,
      locationName: 'Halle',
      postalCode: '10115',
      city: 'Berlin',
      state: 'Berlin',
      country: 'DE',
      latitude: 52.52,
      longitude: 13.405,
      rulesetId: ruleset.id,
      createdById: organizer.id,
      kind: 'BRACKET',
    },
  })
  return { organizer, ruleset, tournament }
}

async function makeParticipant(tournamentId: string, suffix: string, opts: { withDeck?: boolean; reminded?: boolean } = {}) {
  const user = await prisma.user.create({ data: { username: `dls_p_${suffix}`, passwordHash: 'x' } })
  let deckId: string | null = null
  if (opts.withDeck) {
    const deck = await prisma.deck.create({ data: { title: `dls_deck_${suffix}`, userId: user.id } })
    deckId = deck.id
  }
  const participant = await prisma.tournamentParticipant.create({
    data: {
      tournamentId,
      userId: user.id,
      deckId,
      deckReminderSentAt: opts.reminded ? new Date() : null,
    },
  })
  return { user, participant }
}

async function cleanup(tournamentId: string, rulesetId: string, userIds: string[]) {
  await prisma.tournamentParticipant.deleteMany({ where: { tournamentId } })
  await prisma.deck.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } })
  await prisma.tournament.delete({ where: { id: tournamentId } }).catch(() => {})
  await prisma.ruleset.delete({ where: { id: rulesetId } }).catch(() => {})
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
}

describe('runDecklockSweep (#181)', () => {
  it('erinnert Teilnehmer ohne Deck innerhalb des 24h-Fensters — genau einmal, nicht erneut bei einem zweiten Lauf', async () => {
    const suffix = Date.now().toString(36)
    const lockAt = new Date(Date.now() + 10 * 60 * 60 * 1000) // 10h in der Zukunft — innerhalb 24h
    const { organizer, ruleset, tournament } = await makeTournament(suffix, { deckLockAt: lockAt })
    const { user: noDeckUser, participant } = await makeParticipant(tournament.id, `${suffix}_a`)
    const { user: withDeckUser } = await makeParticipant(tournament.id, `${suffix}_b`, { withDeck: true })

    const result1 = await runDecklockSweep()
    expect(result1.remindersSent).toBeGreaterThanOrEqual(1)
    expect(result1.participantsRemoved).toBe(0)

    const afterFirst = await prisma.tournamentParticipant.findUnique({ where: { id: participant.id } })
    expect(afterFirst?.deckReminderSentAt).not.toBeNull()
    const noDeckNotifications = await prisma.notification.findMany({ where: { userId: noDeckUser.id } })
    expect(noDeckNotifications).toHaveLength(1)
    expect(noDeckNotifications[0]!.title).toContain('Deck fehlt')

    // Zweiter Lauf: keine erneute Erinnerung (Dedupe über deckReminderSentAt).
    const result2 = await runDecklockSweep()
    expect(result2.remindersSent).toBe(0)
    const stillOneNotification = await prisma.notification.findMany({ where: { userId: noDeckUser.id } })
    expect(stillOneNotification).toHaveLength(1)

    // Das Deck-tragende Mitglied bleibt in beiden Läufen unangetastet.
    const withDeckNotifications = await prisma.notification.findMany({ where: { userId: withDeckUser.id } })
    expect(withDeckNotifications).toHaveLength(0)

    await cleanup(tournament.id, ruleset.id, [organizer.id, noDeckUser.id, withDeckUser.id])
  })

  it('entfernt Teilnehmer ohne Deck, sobald die Sperrfrist verstrichen ist, und benachrichtigt sie', async () => {
    const suffix = Date.now().toString(36)
    const pastLock = new Date(Date.now() - 60 * 60 * 1000) // 1h in der Vergangenheit
    const { organizer, ruleset, tournament } = await makeTournament(suffix, { deckLockAt: pastLock })
    const { user: noDeckUser, participant } = await makeParticipant(tournament.id, `${suffix}_c`)
    const { user: withDeckUser, participant: keptParticipant } = await makeParticipant(tournament.id, `${suffix}_d`, { withDeck: true })

    const result = await runDecklockSweep()
    expect(result.participantsRemoved).toBe(1)

    expect(await prisma.tournamentParticipant.findUnique({ where: { id: participant.id } })).toBeNull()
    expect(await prisma.tournamentParticipant.findUnique({ where: { id: keptParticipant.id } })).not.toBeNull()

    const removalNotifications = await prisma.notification.findMany({ where: { userId: noDeckUser.id } })
    expect(removalNotifications).toHaveLength(1)
    expect(removalNotifications[0]!.title).toContain('entfernt')

    await cleanup(tournament.id, ruleset.id, [organizer.id, noDeckUser.id, withDeckUser.id])
  })

  it('ohne eigene deckLockAt gilt der Event-Start als Sperrfrist (weit in der Zukunft → keine Aktion)', async () => {
    const suffix = Date.now().toString(36)
    const { organizer, ruleset, tournament } = await makeTournament(suffix, {
      deckLockAt: null,
      startDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 Tage in der Zukunft
    })
    const { user } = await makeParticipant(tournament.id, `${suffix}_e`)

    const result = await runDecklockSweep()
    expect(result.remindersSent).toBe(0)
    expect(result.participantsRemoved).toBe(0)
    expect(await prisma.tournamentParticipant.findFirst({ where: { tournamentId: tournament.id } })).not.toBeNull()

    await cleanup(tournament.id, ruleset.id, [organizer.id, user.id])
  })
})
