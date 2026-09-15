// tests/integration/decklock-gate.test.ts (Issue #181 — "Decklock")
// PATCH/POST .../join must respect the tournament's EFFECTIVE deck lock (Tournament.deckLockAt,
// default startDate — lib/deckLock.ts), independent of the registration window itself: a
// tournament can set deckLockAt well before startDate, and registration (join without a deck)
// must stay open past that point while deck SELECTION does not. Integration — CI-only
// (Postgres/Redis).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { POST as JOIN, PATCH as PATCH_JOIN } from '@/app/api/tournaments/[id]/join/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string }) {
  return { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

function req(method: string, url: string, body?: unknown) {
  return new Request(url, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
}

async function makeValidDeck(title: string, userId: string, suffix: string) {
  const buildIds: string[] = []
  const partIds: string[] = []
  for (let i = 0; i < 3; i++) {
    const blade = await prisma.part.create({ data: { name: `dlg_${suffix}_bl${i}`, category: 'BLADE', manufacturer: 'TT', spinDirection: 'RIGHT' } })
    const ratchet = await prisma.part.create({ data: { name: `dlg_${suffix}_ra${i}`, category: 'RATCHET', manufacturer: 'TT', spinDirection: 'RIGHT' } })
    const bit = await prisma.part.create({ data: { name: `dlg_${suffix}_bi${i}`, category: 'BIT', manufacturer: 'TT', spinDirection: 'RIGHT' } })
    partIds.push(blade.id, ratchet.id, bit.id)
    const build = await prisma.build.create({ data: { bladeId: blade.id, ratchetId: ratchet.id, bitId: bit.id, type: 'ATTACK' } })
    buildIds.push(build.id)
  }
  const deck = await prisma.deck.create({ data: { title, userId, builds: { create: buildIds.map((buildId, position) => ({ buildId, position })) } } })
  return { id: deck.id, partIds, buildIds }
}

describe('Decklock-Gate: deckId setzen/wechseln respektiert die Sperrfrist, nicht nur startDate (#181)', () => {
  afterEach(() => mockAuth.mockReset())

  it('deckLockAt in der Vergangenheit (aber startDate noch in der Zukunft): Registrierung ohne Deck bleibt offen, MIT Deck wird abgelehnt', async () => {
    const suffix = Date.now().toString(36)
    const organizer = await prisma.user.create({ data: { username: `dlg_org_${suffix}`, passwordHash: 'x', role: 'ORGANIZER', isOrganizer: true } })
    const player = await prisma.user.create({ data: { username: `dlg_pla_${suffix}`, passwordHash: 'x' } })
    const ruleset = await prisma.ruleset.create({ data: { title: `dlg_rs_${suffix}`, slug: `dlg-rs-${suffix}`, createdById: organizer.id } })
    const tournament = await prisma.tournament.create({
      data: {
        title: `dlg_t_${suffix}`,
        description: '',
        startDate: new Date(Date.now() + 7 * 86400_000), // Registrierung generell noch offen
        deckLockAt: new Date(Date.now() - 60 * 60 * 1000), // Deck-Sperrfrist bereits verstrichen
        locationName: 'Halle',
        postalCode: '80331',
        city: 'München',
        state: 'Bayern',
        country: 'DE',
        latitude: 48.137,
        longitude: 11.575,
        rulesetId: ruleset.id,
        createdById: organizer.id,
        kind: 'BRACKET',
      },
    })
    const deck = await makeValidDeck(`dlg_deck_${suffix}`, player.id, suffix)
    const joinUrl = `http://localhost/api/tournaments/${tournament.id}/join`
    const ctx = { params: Promise.resolve({ id: tournament.id }) }
    mockAuth.mockResolvedValue(asSession({ id: player.id, name: player.username }))

    // Ohne Deck registrieren bleibt möglich — die Deck-Sperrfrist blockt nur das WÄHLEN eines Decks.
    const joinNoDeck = await JOIN(req('POST', joinUrl, {}), ctx)
    expect(joinNoDeck.status).toBe(201)
    const row = await prisma.tournamentParticipant.findUnique({ where: { tournamentId_userId: { tournamentId: tournament.id, userId: player.id } } })
    expect(row!.deckId).toBeNull()

    // Ein Deck NACH der Sperrfrist nachreichen (PATCH) wird abgelehnt.
    const patchWithDeck = await PATCH_JOIN(req('PATCH', joinUrl, { deckId: deck.id }), ctx)
    expect(patchWithDeck.status).toBe(409)
    expect((await patchWithDeck.json()).error).toBe('deck_locked')
    const stillNoDeck = await prisma.tournamentParticipant.findUnique({ where: { id: row!.id } })
    expect(stillNoDeck!.deckId).toBeNull()

    await prisma.tournamentParticipant.deleteMany({ where: { tournamentId: tournament.id } })
    await prisma.deck.delete({ where: { id: deck.id } })
    await prisma.build.deleteMany({ where: { id: { in: deck.buildIds } } })
    await prisma.part.deleteMany({ where: { id: { in: deck.partIds } } })
    await prisma.tournament.delete({ where: { id: tournament.id } })
    await prisma.ruleset.delete({ where: { id: ruleset.id } })
    await prisma.user.deleteMany({ where: { id: { in: [organizer.id, player.id] } } })
  })

  it('ein Deck vor der Sperrfrist wählen bleibt erlaubt (positiver Gegentest)', async () => {
    const suffix = Date.now().toString(36)
    const organizer = await prisma.user.create({ data: { username: `dlg2_org_${suffix}`, passwordHash: 'x', role: 'ORGANIZER', isOrganizer: true } })
    const player = await prisma.user.create({ data: { username: `dlg2_pla_${suffix}`, passwordHash: 'x' } })
    const ruleset = await prisma.ruleset.create({ data: { title: `dlg2_rs_${suffix}`, slug: `dlg2-rs-${suffix}`, createdById: organizer.id } })
    const tournament = await prisma.tournament.create({
      data: {
        title: `dlg2_t_${suffix}`,
        description: '',
        startDate: new Date(Date.now() + 7 * 86400_000),
        deckLockAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // Sperrfrist noch in der Zukunft
        locationName: 'Halle',
        postalCode: '80331',
        city: 'München',
        state: 'Bayern',
        country: 'DE',
        latitude: 48.137,
        longitude: 11.575,
        rulesetId: ruleset.id,
        createdById: organizer.id,
        kind: 'BRACKET',
      },
    })
    const deck = await makeValidDeck(`dlg2_deck_${suffix}`, player.id, suffix)
    const joinUrl = `http://localhost/api/tournaments/${tournament.id}/join`
    const ctx = { params: Promise.resolve({ id: tournament.id }) }
    mockAuth.mockResolvedValue(asSession({ id: player.id, name: player.username }))

    const join = await JOIN(req('POST', joinUrl, { deckId: deck.id }), ctx)
    expect(join.status).toBe(201)
    const row = await prisma.tournamentParticipant.findUnique({ where: { tournamentId_userId: { tournamentId: tournament.id, userId: player.id } } })
    expect(row!.deckId).toBe(deck.id)

    await prisma.tournamentParticipant.deleteMany({ where: { tournamentId: tournament.id } })
    await prisma.deck.delete({ where: { id: deck.id } })
    await prisma.build.deleteMany({ where: { id: { in: deck.buildIds } } })
    await prisma.part.deleteMany({ where: { id: { in: deck.partIds } } })
    await prisma.tournament.delete({ where: { id: tournament.id } })
    await prisma.ruleset.delete({ where: { id: ruleset.id } })
    await prisma.user.deleteMany({ where: { id: { in: [organizer.id, player.id] } } })
  })
})
