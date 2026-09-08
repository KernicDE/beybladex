// tests/integration/account-export.test.ts
// Task 12: GET /api/account/export (GDPR Art. 20). Integration — CI-only (Postgres/Redis).
import { describe, it, expect, vi, afterEach } from 'vitest'
import bcrypt from 'bcryptjs'
import { GET } from '@/app/api/account/export/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return value as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

describe('GET /api/account/export (Art. 20)', () => {
  const suffix = Date.now().toString(36)
  const usernameA = `expa_${suffix}`
  const usernameB = `expb_${suffix}`
  const ids: {
    users: string[]; clubs: string[]; rulesets: string[]; tournaments: string[]
    decks: string[]; builds: string[]; notifications: string[]; friendships: string[]
    collectionItems: string[]; clubMembers: string[]; participants: string[]
  } = {
    users: [], clubs: [], rulesets: [], tournaments: [], decks: [], builds: [],
    notifications: [], friendships: [], collectionItems: [], clubMembers: [], participants: [],
  }

  afterEach(async () => {
    mockAuth.mockReset()
    // delete children before parents (no cascade on most of these relations)
    for (const id of ids.participants) await prisma.tournamentParticipant.delete({ where: { id } }).catch(() => {})
    for (const id of ids.clubMembers) await prisma.clubMember.delete({ where: { id } }).catch(() => {})
    for (const id of ids.friendships) await prisma.friendship.delete({ where: { id } }).catch(() => {})
    for (const id of ids.notifications) await prisma.notification.delete({ where: { id } }).catch(() => {})
    for (const id of ids.collectionItems) await prisma.collectionItem.delete({ where: { id } }).catch(() => {})
    for (const deckId of ids.decks) {
      await prisma.deckBuild.deleteMany({ where: { deckId } })
      await prisma.deck.delete({ where: { id: deckId } }).catch(() => {})
    }
    for (const id of ids.builds) await prisma.build.delete({ where: { id } }).catch(() => {})
    for (const id of ids.tournaments) await prisma.tournament.delete({ where: { id } }).catch(() => {})
    for (const id of ids.clubs) await prisma.club.delete({ where: { id } }).catch(() => {})
    for (const id of ids.rulesets) await prisma.ruleset.delete({ where: { id } }).catch(() => {})
    for (const id of ids.users) await prisma.user.delete({ where: { id } }).catch(() => {})
    for (const key of Object.keys(ids)) (ids[key as keyof typeof ids]).length = 0
  })

  it('exports every documented category, scoped to the session user only', async () => {
    const passwordHash = await bcrypt.hash('correct horse battery staple', 12)
    const userA = await prisma.user.create({
      data: {
        username: usernameA,
        passwordHash,
        email: 'a@example.de',
        displayName: 'Export A',
        bio: 'Ich werde exportiert',
        city: 'Leipzig',
        discordTag: 'a#0001',
        notifyRadiusKm: 75,
        notifyRecurring: true,
        notifyEmail: true,
      },
    })
    const userB = await prisma.user.create({ data: { username: usernameB, passwordHash } })
    ids.users.push(userA.id, userB.id)

    const ruleset = await prisma.ruleset.create({
      data: { title: `Export Ruleset ${suffix}`, slug: `export-ruleset-${suffix}`, createdById: userA.id },
    })
    ids.rulesets.push(ruleset.id)
    const tournament = await prisma.tournament.create({
      data: {
        title: `Export Turnier ${suffix}`,
        description: 'Export-Test',
        startDate: new Date('2027-01-01T10:00:00Z'),
        locationName: 'Spielhalle',
        postalCode: '04109',
        city: 'Leipzig',
        state: 'Sachsen',
        latitude: 51.34,
        longitude: 12.37,
        rulesetId: ruleset.id,
      },
    })
    ids.tournaments.push(tournament.id)
    const build = await prisma.build.create({ data: { bladeId: 'blade-1', ratchetId: 'ratchet-1', bitId: 'bit-1' } })
    ids.builds.push(build.id)
    const deck = await prisma.deck.create({ data: { title: 'Export-Deck', userId: userA.id } })
    ids.decks.push(deck.id)
    await prisma.deckBuild.create({ data: { deckId: deck.id, buildId: build.id, position: 1 } })
    const itemA = await prisma.collectionItem.create({ data: { userId: userA.id, partOrBeyId: 'part-1', purchasePrice: 12.99 } })
    const itemB = await prisma.collectionItem.create({ data: { userId: userB.id, partOrBeyId: 'part-2', purchasePrice: 99.99 } })
    ids.collectionItems.push(itemA.id, itemB.id)
    const friendship = await prisma.friendship.create({ data: { requesterId: userA.id, addresseeId: userB.id, status: 'ACCEPTED' } })
    ids.friendships.push(friendship.id)
    const club = await prisma.club.create({ data: { name: `Export Club ${suffix}`, slug: `export-club-${suffix}`, ownerId: userB.id } })
    ids.clubs.push(club.id)
    const membership = await prisma.clubMember.create({ data: { clubId: club.id, userId: userA.id } })
    ids.clubMembers.push(membership.id)
    const participant = await prisma.tournamentParticipant.create({ data: { tournamentId: tournament.id, userId: userA.id, deckId: deck.id, checkedIn: true } })
    ids.participants.push(participant.id)
    const notification = await prisma.notification.create({ data: { userId: userA.id, title: 'Hallo', message: 'Export-Benachrichtigung' } })
    ids.notifications.push(notification.id)

    mockAuth.mockResolvedValue(asSession({ id: userA.id, name: usernameA }))
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()

    // every documented category is present
    expect(body).toHaveProperty('profile')
    expect(body).toHaveProperty('collection')
    expect(body).toHaveProperty('decks')
    expect(body).toHaveProperty('ratings') // empty at Phase 1 — Rating.userId lands in Phase 5
    expect(body).toHaveProperty('friendships')
    expect(body).toHaveProperty('clubMemberships')
    expect(body).toHaveProperty('notificationPreferences')
    expect(body).toHaveProperty('tournamentParticipations')

    // profile contains the owner's own fields
    expect(body.profile).toMatchObject({
      username: usernameA,
      displayName: 'Export A',
      email: 'a@example.de',
      city: 'Leipzig',
      notifyRadiusKm: 75,
      notifyRecurring: true,
      notifyEmail: true,
    })
    expect(body.profile.passwordHash).toBeUndefined()

    // per-category rows belong to the owner only — nothing of user B leaks
    expect(body.collection).toHaveLength(1)
    expect(body.collection[0].partOrBeyId).toBe('part-1')
    expect(JSON.stringify(body)).not.toContain('part-2')
    expect(body.decks).toHaveLength(1)
    expect(body.decks[0].title).toBe('Export-Deck')
    expect(body.decks[0].builds).toHaveLength(1)
    expect(body.friendships).toHaveLength(1)
    expect(body.friendships[0].status).toBe('ACCEPTED')
    expect(body.clubMemberships).toHaveLength(1)
    expect(body.clubMemberships[0].club.slug).toBe(`export-club-${suffix}`)
    expect(body.notificationPreferences).toMatchObject({ notifyRadiusKm: 75, notifyRecurring: true, notifyEmail: true })
    expect(body.tournamentParticipations).toHaveLength(1)
    expect(body.tournamentParticipations[0].tournament.title).toBe(`Export Turnier ${suffix}`)
    expect(body.tournamentParticipations[0].checkedIn).toBe(true)
    expect(body.ratings).toEqual([])
  })

  it('returns 401 without a session', async () => {
    mockAuth.mockResolvedValue(asSession(null))
    const res = await GET()
    expect(res.status).toBe(401)
  })
})
