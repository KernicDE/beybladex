// tests/integration/tournament-join-deck-format.test.ts (Phase 16 item 5)
// Integration — CI-only (Postgres). POST /api/tournaments/[id]/join re-validates the chosen
// deck against the tournament's linked Ruleset.deckFormat: a deck with the wrong build count
// for that format is rejected at join with 400; a matching deck is accepted.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { POST as JOIN } from '@/app/api/tournaments/[id]/join/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

function post(body: unknown) {
  return new Request('http://localhost/x/join', { method: 'POST', body: JSON.stringify(body) })
}

afterEach(() => mockAuth.mockReset())

describe('tournament join deck-format re-validation', () => {
  it('rejects a 1-build deck registering for a WBO_COUNTERDECK (3-build) tournament with 400', async () => {
    const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const organizer = await prisma.user.create({ data: { username: `jdf_org_${suffix}`, passwordHash: 'x', role: 'ORGANIZER' } })
    const player = await prisma.user.create({ data: { username: `jdf_ply_${suffix}`, passwordHash: 'x' } })

    const blade = await prisma.part.create({ data: { name: `Bl ${suffix}`, manufacturer: 'TT', category: 'BLADE', spinDirection: 'RIGHT' } })
    const ratchet = await prisma.part.create({ data: { name: `R ${suffix}`, manufacturer: 'TT', category: 'RATCHET', spinDirection: 'RIGHT' } })
    const bit = await prisma.part.create({ data: { name: `Bit ${suffix}`, manufacturer: 'TT', category: 'BIT', spinDirection: 'RIGHT' } })
    const build = await prisma.build.create({ data: { name: `B ${suffix}`, type: 'ATTACK', bladeId: blade.id, ratchetId: ratchet.id, bitId: bit.id } })
    const deck = await prisma.deck.create({
      data: { title: `1-build deck ${suffix}`, userId: player.id, builds: { create: [{ buildId: build.id, position: 1 }] } },
    })

    const ruleset = await prisma.ruleset.create({
      data: { title: `JDF RS ${suffix}`, slug: `jdf-rs-${suffix}`, createdById: organizer.id, deckFormat: 'WBO_COUNTERDECK' },
    })
    const tournament = await prisma.tournament.create({
      data: {
        title: `JDF T ${suffix}`, description: '', startDate: new Date(Date.now() + 86400_000), locationName: 'Arena',
        postalCode: '10115', city: 'Berlin', state: 'Berlin', latitude: 52.52, longitude: 13.405,
        rulesetId: ruleset.id, createdById: organizer.id,
      },
    })

    mockAuth.mockResolvedValue(asSession({ id: player.id, name: player.username }))
    const res = await JOIN(post({ deckId: deck.id }), { params: Promise.resolve({ id: tournament.id }) })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('deck_format_mismatch')

    const participant = await prisma.tournamentParticipant.findUnique({ where: { tournamentId_userId: { tournamentId: tournament.id, userId: player.id } } })
    expect(participant).toBeNull() // registration must not have gone through
  })

  it('accepts a 1-build deck for a ONE_ON_ONE tournament', async () => {
    const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const organizer = await prisma.user.create({ data: { username: `jdf2_org_${suffix}`, passwordHash: 'x', role: 'ORGANIZER' } })
    const player = await prisma.user.create({ data: { username: `jdf2_ply_${suffix}`, passwordHash: 'x' } })

    const blade = await prisma.part.create({ data: { name: `Bl2 ${suffix}`, manufacturer: 'TT', category: 'BLADE', spinDirection: 'RIGHT' } })
    const ratchet = await prisma.part.create({ data: { name: `R2 ${suffix}`, manufacturer: 'TT', category: 'RATCHET', spinDirection: 'RIGHT' } })
    const bit = await prisma.part.create({ data: { name: `Bit2 ${suffix}`, manufacturer: 'TT', category: 'BIT', spinDirection: 'RIGHT' } })
    const build = await prisma.build.create({ data: { name: `B2 ${suffix}`, type: 'ATTACK', bladeId: blade.id, ratchetId: ratchet.id, bitId: bit.id } })
    const deck = await prisma.deck.create({
      data: { title: `1-build deck 2 ${suffix}`, userId: player.id, builds: { create: [{ buildId: build.id, position: 1 }] } },
    })

    const ruleset = await prisma.ruleset.create({
      data: { title: `JDF2 RS ${suffix}`, slug: `jdf2-rs-${suffix}`, createdById: organizer.id, deckFormat: 'ONE_ON_ONE' },
    })
    const tournament = await prisma.tournament.create({
      data: {
        title: `JDF2 T ${suffix}`, description: '', startDate: new Date(Date.now() + 86400_000), locationName: 'Arena',
        postalCode: '10115', city: 'Berlin', state: 'Berlin', latitude: 52.52, longitude: 13.405,
        rulesetId: ruleset.id, createdById: organizer.id,
      },
    })

    mockAuth.mockResolvedValue(asSession({ id: player.id, name: player.username }))
    const res = await JOIN(post({ deckId: deck.id }), { params: Promise.resolve({ id: tournament.id }) })
    expect(res.status).toBe(201)
  })
})
