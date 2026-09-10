// tests/integration/tournament-start-lock.test.ts (Phase 16 item 6)
// Integration — CI-only (Postgres). POST /api/tournaments/[id]/start: organizer-only negative-
// authz test; after start, every registered participant's lockedBuildIds is populated and
// matches their deck's builds at that moment; a subsequent edit to the live Deck does not
// change the snapshot; a tournament whose ruleset has lockedDecks: false takes no snapshot.
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

async function seedUser(suffix: string, prefix: string, role: 'USER' | 'ORGANIZER' = 'USER') {
  return prisma.user.create({ data: { username: `${prefix}_${suffix}`, passwordHash: 'x', role } })
}

async function seedDeck(suffix: string, prefix: string, userId: string) {
  const blade = await prisma.part.create({ data: { name: `Bl-${prefix} ${suffix}`, manufacturer: 'TT', category: 'BLADE', spinDirection: 'RIGHT' } })
  const ratchet = await prisma.part.create({ data: { name: `R-${prefix} ${suffix}`, manufacturer: 'TT', category: 'RATCHET', spinDirection: 'RIGHT' } })
  const bit = await prisma.part.create({ data: { name: `Bit-${prefix} ${suffix}`, manufacturer: 'TT', category: 'BIT', spinDirection: 'RIGHT' } })
  const build = await prisma.build.create({ data: { name: `B-${prefix} ${suffix}`, type: 'ATTACK', bladeId: blade.id, ratchetId: ratchet.id, bitId: bit.id } })
  const deck = await prisma.deck.create({ data: { title: `Deck-${prefix} ${suffix}`, userId, builds: { create: [{ buildId: build.id, position: 1 }] } } })
  return { deck, build, blade, ratchet, bit }
}

afterEach(() => mockAuth.mockReset())

describe('tournament start — deck lock-in', () => {
  it('a non-owner non-admin is 403; unauthenticated is 401', async () => {
    const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const owner = await seedUser(suffix, 'tslow', 'ORGANIZER')
    const other = await seedUser(suffix, 'tslot', 'ORGANIZER')
    const ruleset = await prisma.ruleset.create({ data: { title: `TSL RS ${suffix}`, slug: `tsl-rs-${suffix}`, createdById: owner.id, lockedDecks: true } })
    const tournament = await prisma.tournament.create({
      data: {
        title: `TSL T ${suffix}`, description: '', startDate: new Date(Date.now() + 86400_000), locationName: 'Arena',
        postalCode: '10115', city: 'Berlin', state: 'Berlin', latitude: 52.52, longitude: 13.405,
        rulesetId: ruleset.id, createdById: owner.id,
      },
    })
    const ctx = { params: Promise.resolve({ id: tournament.id }) }

    mockAuth.mockResolvedValue(asSession(null))
    expect((await START(req(), ctx)).status).toBe(401)

    mockAuth.mockResolvedValue(asSession({ id: other.id, name: other.username }))
    expect((await START(req(), ctx)).status).toBe(403)
  })

  it('a locked-decks ruleset snapshots every participant deck, and a later live-deck edit does not retroactively change it', async () => {
    const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const owner = await seedUser(suffix, 'tsl2ow', 'ORGANIZER')
    const player = await seedUser(suffix, 'tsl2pl')
    const { deck, build } = await seedDeck(suffix, 'tsl2', player.id)

    const ruleset = await prisma.ruleset.create({ data: { title: `TSL2 RS ${suffix}`, slug: `tsl2-rs-${suffix}`, createdById: owner.id, lockedDecks: true } })
    const tournament = await prisma.tournament.create({
      data: {
        title: `TSL2 T ${suffix}`, description: '', startDate: new Date(Date.now() + 86400_000), locationName: 'Arena',
        postalCode: '10115', city: 'Berlin', state: 'Berlin', latitude: 52.52, longitude: 13.405,
        rulesetId: ruleset.id, createdById: owner.id,
      },
    })
    await prisma.tournamentParticipant.create({ data: { tournamentId: tournament.id, userId: player.id, deckId: deck.id } })

    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    const res = await START(req(), { params: Promise.resolve({ id: tournament.id }) })
    expect(res.status).toBe(200)

    const participant = await prisma.tournamentParticipant.findUnique({ where: { tournamentId_userId: { tournamentId: tournament.id, userId: player.id } } })
    expect(participant?.lockedBuildIds).toEqual([build.id])

    // A second start attempt is a 409 (one-way action).
    const second = await START(req(), { params: Promise.resolve({ id: tournament.id }) })
    expect(second.status).toBe(409)

    // Editing the live deck afterward (swap in a new build) must not retroactively change the
    // already-taken snapshot.
    const { build: newBuild } = await seedDeck(suffix, 'tsl2-new', player.id)
    await prisma.deckBuild.deleteMany({ where: { deckId: deck.id } })
    await prisma.deckBuild.create({ data: { deckId: deck.id, buildId: newBuild.id, position: 1 } })

    const stillSnapshotted = await prisma.tournamentParticipant.findUnique({ where: { tournamentId_userId: { tournamentId: tournament.id, userId: player.id } } })
    expect(stillSnapshotted?.lockedBuildIds).toEqual([build.id]) // unchanged, not [newBuild.id]
  })

  it('a ruleset with lockedDecks: false takes no snapshot', async () => {
    const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const owner = await seedUser(suffix, 'tsl3ow', 'ORGANIZER')
    const player = await seedUser(suffix, 'tsl3pl')
    const { deck } = await seedDeck(suffix, 'tsl3', player.id)

    const ruleset = await prisma.ruleset.create({ data: { title: `TSL3 RS ${suffix}`, slug: `tsl3-rs-${suffix}`, createdById: owner.id, lockedDecks: false } })
    const tournament = await prisma.tournament.create({
      data: {
        title: `TSL3 T ${suffix}`, description: '', startDate: new Date(Date.now() + 86400_000), locationName: 'Arena',
        postalCode: '10115', city: 'Berlin', state: 'Berlin', latitude: 52.52, longitude: 13.405,
        rulesetId: ruleset.id, createdById: owner.id,
      },
    })
    await prisma.tournamentParticipant.create({ data: { tournamentId: tournament.id, userId: player.id, deckId: deck.id } })

    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    const res = await START(req(), { params: Promise.resolve({ id: tournament.id }) })
    expect(res.status).toBe(200)

    const participant = await prisma.tournamentParticipant.findUnique({ where: { tournamentId_userId: { tournamentId: tournament.id, userId: player.id } } })
    expect(participant?.lockedBuildIds).toEqual([])
  })
})
