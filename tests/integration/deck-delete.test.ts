// tests/integration/deck-delete.test.ts (#164)
// Verifiziert gegen die echte DB, dass ein Deck IMMER löschbar ist — auch wenn es bereits in
// einem Turnier registriert war: DeckBuild.deckId ist ON DELETE CASCADE,
// TournamentParticipant.deckId ist ON DELETE SET NULL (prisma/migrations/00000000000000_init).
// CI-only (Postgres/Redis).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { DELETE } from '@/app/api/decks/[id]/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

afterEach(() => mockAuth.mockReset())

describe('DELETE /api/decks/[id] (#164)', () => {
  it('löscht ein leeres Deck (200)', async () => {
    const suffix = Date.now().toString(36)
    const user = await prisma.user.create({ data: { username: `dd_usr_${suffix}`, passwordHash: 'x' } })
    const deck = await prisma.deck.create({ data: { title: `Deck ${suffix}`, userId: user.id } })
    mockAuth.mockResolvedValue(asSession({ id: user.id, name: user.username }))

    const res = await DELETE(new Request(`http://localhost/api/decks/${deck.id}`, { method: 'DELETE' }), ctx(deck.id))
    expect(res.status).toBe(200)
    expect(await prisma.deck.findUnique({ where: { id: deck.id } })).toBeNull()

    await prisma.user.delete({ where: { id: user.id } })
  })

  it('löscht ein Deck, das noch einen Build enthält UND bereits einem Turnier-Teilnehmer zugeordnet ist', async () => {
    const suffix = Date.now().toString(36)
    const user = await prisma.user.create({ data: { username: `dd_usr2_${suffix}`, passwordHash: 'x' } })
    const blade = await prisma.part.create({ data: { name: `dd_blade_${suffix}`, category: 'BLADE', manufacturer: 'TT', spinDirection: 'RIGHT' } })
    const ratchet = await prisma.part.create({ data: { name: `dd_ratchet_${suffix}`, category: 'RATCHET', manufacturer: 'TT', spinDirection: 'RIGHT' } })
    const bit = await prisma.part.create({ data: { name: `dd_bit_${suffix}`, category: 'BIT', manufacturer: 'TT', spinDirection: 'RIGHT' } })
    const build = await prisma.build.create({ data: { bladeId: blade.id, ratchetId: ratchet.id, bitId: bit.id, type: 'ATTACK', creatorId: user.id } })
    const deck = await prisma.deck.create({ data: { title: `Deck2 ${suffix}`, userId: user.id } })
    await prisma.deckBuild.create({ data: { deckId: deck.id, buildId: build.id, position: 0 } })

    const ruleset = await prisma.ruleset.create({
      data: { title: `Ruleset ${suffix}`, slug: `dd-ruleset-${suffix}`, createdById: user.id, deckFormat: 'ONE_ON_ONE' },
    })
    const tournament = await prisma.tournament.create({
      data: {
        title: `T ${suffix}`, description: '', startDate: new Date(Date.now() + 86400_000), locationName: 'Arena',
        postalCode: '10115', city: 'Berlin', state: 'Berlin', latitude: 52.52, longitude: 13.405,
        rulesetId: ruleset.id, createdById: user.id,
      },
    })
    const participant = await prisma.tournamentParticipant.create({
      data: { tournamentId: tournament.id, userId: user.id, deckId: deck.id },
    })

    mockAuth.mockResolvedValue(asSession({ id: user.id, name: user.username }))
    const res = await DELETE(new Request(`http://localhost/api/decks/${deck.id}`, { method: 'DELETE' }), ctx(deck.id))
    expect(res.status).toBe(200)
    expect(await prisma.deck.findUnique({ where: { id: deck.id } })).toBeNull()
    expect(await prisma.deckBuild.findMany({ where: { deckId: deck.id } })).toHaveLength(0)
    // TournamentParticipant bleibt bestehen, nur deckId wird SET NULL.
    const remaining = await prisma.tournamentParticipant.findUnique({ where: { id: participant.id } })
    expect(remaining?.deckId).toBeNull()

    await prisma.tournamentParticipant.delete({ where: { id: participant.id } })
    await prisma.tournament.delete({ where: { id: tournament.id } })
    await prisma.ruleset.delete({ where: { id: ruleset.id } })
    await prisma.build.delete({ where: { id: build.id } })
    await prisma.part.deleteMany({ where: { id: { in: [blade.id, ratchet.id, bit.id] } } })
    await prisma.user.delete({ where: { id: user.id } })
  })

  it('fremdes Deck → 404, bleibt bestehen', async () => {
    const suffix = Date.now().toString(36)
    const owner = await prisma.user.create({ data: { username: `dd_owner_${suffix}`, passwordHash: 'x' } })
    const other = await prisma.user.create({ data: { username: `dd_other_${suffix}`, passwordHash: 'x' } })
    const deck = await prisma.deck.create({ data: { title: `Deck3 ${suffix}`, userId: owner.id } })
    mockAuth.mockResolvedValue(asSession({ id: other.id, name: other.username }))

    const res = await DELETE(new Request(`http://localhost/api/decks/${deck.id}`, { method: 'DELETE' }), ctx(deck.id))
    expect(res.status).toBe(404)
    expect(await prisma.deck.findUnique({ where: { id: deck.id } })).not.toBeNull()

    await prisma.deck.delete({ where: { id: deck.id } })
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, other.id] } } })
  })
})
