// tests/integration/tournament-join-flow.test.ts
// Phase 3: the platform's primary journey end-to-end in ONE test, per the master plan's
// acceptance criterion: join (with and without a deckId), change deckId before startDate
// (200) and after (409), duplicate join (409 — proves @@unique([tournamentId, userId]) is
// load-bearing), self-check-in, and organizer-initiated check-in — plus the authz negatives:
// joining with someone else's deckId → 403, a stranger checking in another participant → 403.
// Integration — CI-only (Postgres/Redis).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { POST as JOIN, PATCH as PATCH_JOIN, DELETE as WITHDRAW } from '@/app/api/tournaments/[id]/join/route'
import { PATCH as CHECKIN } from '@/app/api/tournaments/[id]/checkin/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

function req(method: string, url: string, body?: unknown) {
  return new Request(url, {
    method,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

// [FIX] Phase 16 added format-aware deck validation at join/deck-edit time (the tournament's
// linked Ruleset.deckFormat defaults to WBO_COUNTERDECK, which requires exactly 3 builds with
// no part reused across them) — this test's deck fixtures were empty (0 builds), a pattern
// that predates Phase 16 and was never actually exercised against real validation until CI
// started running to completion. Gives each deck 3 builds with fully distinct parts (no blade/
// ratchet/bit reused across the three, satisfying validateNoDuplicateParts too).
async function makeValidDeck(title: string, userId: string, suffix: string): Promise<{ id: string; partIds: string[]; buildIds: string[] }> {
  const partIds: string[] = []
  const buildIds: string[] = []
  for (let i = 0; i < 3; i++) {
    const blade = await prisma.part.create({ data: { name: `jf_${suffix}_bl${i}`, category: 'BLADE', manufacturer: 'TT', spinDirection: 'RIGHT' } })
    const ratchet = await prisma.part.create({ data: { name: `jf_${suffix}_ra${i}`, category: 'RATCHET', manufacturer: 'TT', spinDirection: 'RIGHT' } })
    const bit = await prisma.part.create({ data: { name: `jf_${suffix}_bi${i}`, category: 'BIT', manufacturer: 'TT', spinDirection: 'RIGHT' } })
    partIds.push(blade.id, ratchet.id, bit.id)
    const build = await prisma.build.create({ data: { bladeId: blade.id, ratchetId: ratchet.id, bitId: bit.id, type: 'ATTACK' } })
    buildIds.push(build.id)
  }
  const deck = await prisma.deck.create({
    data: { title, userId, builds: { create: buildIds.map((buildId, position) => ({ buildId, position })) } },
  })
  return { id: deck.id, partIds, buildIds }
}

describe('tournament join flow', () => {
  afterEach(() => {
    mockAuth.mockReset()
  })

  it('walks the full player journey: join → edit deck → duplicate join → check-in (self + organizer)', async () => {
    const suffix = Date.now().toString(36)
    const organizer = await prisma.user.create({ data: { username: `jf_org_${suffix}`, passwordHash: 'x', role: 'ORGANIZER' } })
    const player = await prisma.user.create({ data: { username: `jf_pla_${suffix}`, passwordHash: 'x' } })
    const player2 = await prisma.user.create({ data: { username: `jf_pl2_${suffix}`, passwordHash: 'x' } })
    const stranger = await prisma.user.create({ data: { username: `jf_str_${suffix}`, passwordHash: 'x' } })
    const ruleset = await prisma.ruleset.create({ data: { title: `RS ${suffix}`, slug: `rs-${suffix}`, createdById: organizer.id } })
    const tournament = await prisma.tournament.create({
      data: {
        title: `Journey ${suffix}`,
        description: '',
        startDate: new Date(Date.now() + 7 * 86400_000), // a week out — edits still open
        locationName: 'Bey-Arena',
        postalCode: '80331',
        city: 'München',
        state: 'Bayern',
        latitude: 48.137,
        longitude: 11.575,
        rulesetId: ruleset.id,
        createdById: organizer.id,
      },
    })
    const deckA = await makeValidDeck(`Deck A ${suffix}`, player.id, `${suffix}a`)
    const deckB = await makeValidDeck(`Deck B ${suffix}`, player.id, `${suffix}b`)
    const foreignDeck = await makeValidDeck(`Deck F ${suffix}`, player2.id, `${suffix}f`)

    const joinUrl = `http://localhost/api/tournaments/${tournament.id}/join`
    const checkinUrl = `http://localhost/api/tournaments/${tournament.id}/checkin`
    const ctx = { params: Promise.resolve({ id: tournament.id }) }

    // 1. Join WITHOUT a deckId
    mockAuth.mockResolvedValue(asSession({ id: player.id, name: player.username }))
    const join1 = await JOIN(req('POST', joinUrl, {}), ctx)
    expect(join1.status).toBe(201)
    let row = await prisma.tournamentParticipant.findUnique({
      where: { tournamentId_userId: { tournamentId: tournament.id, userId: player.id } },
    })
    expect(row).not.toBeNull()
    expect(row!.deckId).toBeNull()
    expect(row!.checkedIn).toBe(false)

    // 2. Join WITH a deckId (player2 brings their own deck)
    mockAuth.mockResolvedValue(asSession({ id: player2.id, name: player2.username }))
    expect((await JOIN(req('POST', joinUrl, { deckId: foreignDeck.id }), ctx)).status).toBe(201)

    // 3. Joining with a deckId that is NOT the caller's is 403
    mockAuth.mockResolvedValue(asSession({ id: stranger.id, name: stranger.username }))
    const foreign = await JOIN(req('POST', joinUrl, { deckId: foreignDeck.id }), ctx)
    expect(foreign.status).toBe(403)
    expect((await foreign.json()).error).toBe('invalid_deck')

    // 4. Duplicate join hits @@unique([tournamentId, userId]) → 409
    mockAuth.mockResolvedValue(asSession({ id: player.id, name: player.username }))
    const dup = await JOIN(req('POST', joinUrl, {}), ctx)
    expect(dup.status).toBe(409)
    expect((await dup.json()).error).toBe('already_joined')

    // 5. Change deckId BEFORE startDate → 200
    const edit = await PATCH_JOIN(req('PATCH', joinUrl, { deckId: deckA.id }), ctx)
    expect(edit.status).toBe(200)
    row = await prisma.tournamentParticipant.findUnique({
      where: { tournamentId_userId: { tournamentId: tournament.id, userId: player.id } },
    })
    expect(row!.deckId).toBe(deckA.id)

    // 6. Self-check-in → checkedIn = true
    const selfCheckin = await CHECKIN(req('PATCH', checkinUrl, {}), ctx)
    expect(selfCheckin.status).toBe(200)
    row = await prisma.tournamentParticipant.findUnique({
      where: { tournamentId_userId: { tournamentId: tournament.id, userId: player.id } },
    })
    expect(row!.checkedIn).toBe(true)

    // 7. Organizer-initiated check-in for player2 → 200; a stranger attempting it → 403
    mockAuth.mockResolvedValue(asSession({ id: organizer.id, name: organizer.username }))
    const orgCheckin = await CHECKIN(req('PATCH', checkinUrl, { userId: player2.id }), ctx)
    expect(orgCheckin.status).toBe(200)
    expect((await orgCheckin.json()).checkedIn).toBe(true)

    mockAuth.mockResolvedValue(asSession({ id: stranger.id, name: stranger.username }))
    const evilCheckin = await CHECKIN(req('PATCH', checkinUrl, { userId: player2.id }), ctx)
    expect(evilCheckin.status).toBe(403)

    // 8. Once startDate has passed: deckId change → 409, withdraw → 409
    await prisma.tournament.update({ where: { id: tournament.id }, data: { startDate: new Date(Date.now() - 3600_000) } })
    mockAuth.mockResolvedValue(asSession({ id: player.id, name: player.username }))
    expect((await PATCH_JOIN(req('PATCH', joinUrl, { deckId: deckB.id }), ctx)).status).toBe(409)
    expect((await WITHDRAW(req('DELETE', joinUrl), ctx)).status).toBe(409)
    // …and the earlier deck choice is untouched by the rejected edit
    row = await prisma.tournamentParticipant.findUnique({
      where: { tournamentId_userId: { tournamentId: tournament.id, userId: player.id } },
    })
    expect(row!.deckId).toBe(deckA.id)

    // cleanup (participants first — no cascade on the tournament FK in spec §3)
    await prisma.tournamentParticipant.deleteMany({ where: { tournamentId: tournament.id } })
    await prisma.tournament.delete({ where: { id: tournament.id } })
    await prisma.deck.deleteMany({ where: { userId: { in: [player.id, player2.id] } } }) // cascades DeckBuild
    await prisma.build.deleteMany({ where: { id: { in: [...deckA.buildIds, ...deckB.buildIds, ...foreignDeck.buildIds] } } })
    await prisma.part.deleteMany({ where: { id: { in: [...deckA.partIds, ...deckB.partIds, ...foreignDeck.partIds] } } })
    await prisma.ruleset.delete({ where: { id: ruleset.id } })
    await prisma.user.deleteMany({ where: { id: { in: [organizer.id, player.id, player2.id, stranger.id] } } })
  })

  it('registration closes at the earlier of startDate or an already-generated bracket', async () => {
    const suffix = Date.now().toString(36)
    const organizer = await prisma.user.create({ data: { username: `jf_org2_${suffix}`, passwordHash: 'x', role: 'ORGANIZER' } })
    const late = await prisma.user.create({ data: { username: `jf_late_${suffix}`, passwordHash: 'x' } })
    const ruleset = await prisma.ruleset.create({ data: { title: `RS2 ${suffix}`, slug: `rs2-${suffix}`, createdById: organizer.id } })

    // Case A: startDate already passed → 409, even with no bracket at all.
    const started = await prisma.tournament.create({
      data: {
        title: `Started ${suffix}`,
        description: '',
        startDate: new Date(Date.now() - 3600_000),
        locationName: 'Bey-Arena',
        postalCode: '10115',
        city: 'Berlin',
        state: 'Berlin',
        latitude: 52.52,
        longitude: 13.405,
        rulesetId: ruleset.id,
        createdById: organizer.id,
      },
    })
    mockAuth.mockResolvedValue(asSession({ id: late.id, name: late.username }))
    const afterStart = await JOIN(req('POST', `http://localhost/api/tournaments/${started.id}/join`, {}), { params: Promise.resolve({ id: started.id }) })
    expect(afterStart.status).toBe(409)
    expect((await afterStart.json()).error).toBe('registration_closed')
    expect(await prisma.tournamentParticipant.findUnique({ where: { tournamentId_userId: { tournamentId: started.id, userId: late.id } } })).toBeNull()

    // Case B: startDate is still a week out, but a stage's bracket already has matches →
    // registration must close anyway (the participant pool is already structurally fixed).
    const upcoming = await prisma.tournament.create({
      data: {
        title: `Upcoming ${suffix}`,
        description: '',
        startDate: new Date(Date.now() + 7 * 86400_000),
        locationName: 'Bey-Arena',
        postalCode: '10115',
        city: 'Berlin',
        state: 'Berlin',
        latitude: 52.52,
        longitude: 13.405,
        rulesetId: ruleset.id,
        createdById: organizer.id,
      },
    })
    const stage = await prisma.tournamentStage.create({
      data: { tournamentId: upcoming.id, order: 1, name: 'Hauptbracket', format: 'SINGLE_ELIMINATION' },
    })
    const match = await prisma.match.create({ data: { tournamentId: upcoming.id, stageId: stage.id, round: 1, bracketOrder: 0 } })
    const afterBracket = await JOIN(req('POST', `http://localhost/api/tournaments/${upcoming.id}/join`, {}), { params: Promise.resolve({ id: upcoming.id }) })
    expect(afterBracket.status).toBe(409)
    expect((await afterBracket.json()).error).toBe('registration_closed')

    await prisma.match.delete({ where: { id: match.id } })
    await prisma.tournamentStage.delete({ where: { id: stage.id } })
    await prisma.tournament.delete({ where: { id: upcoming.id } })
    await prisma.tournament.delete({ where: { id: started.id } })
    await prisma.ruleset.delete({ where: { id: ruleset.id } })
    await prisma.user.deleteMany({ where: { id: { in: [organizer.id, late.id] } } })
  })

  it('unauthenticated join and check-in are 401', async () => {
    const suffix = Date.now().toString(36)
    const organizer = await prisma.user.create({ data: { username: `jf_org_${suffix}`, passwordHash: 'x', role: 'ORGANIZER' } })
    const ruleset = await prisma.ruleset.create({ data: { title: `RS ${suffix}`, slug: `rs-${suffix}`, createdById: organizer.id } })
    const tournament = await prisma.tournament.create({
      data: {
        title: `Anon ${suffix}`,
        description: '',
        startDate: new Date(Date.now() + 86400_000),
        locationName: 'Bey-Arena',
        postalCode: '10115',
        city: 'Berlin',
        state: 'Berlin',
        latitude: 52.52,
        longitude: 13.405,
        rulesetId: ruleset.id,
        createdById: organizer.id,
      },
    })
    const ctx = { params: Promise.resolve({ id: tournament.id }) }
    mockAuth.mockResolvedValue(asSession(null))

    expect((await JOIN(req('POST', `http://localhost/api/tournaments/${tournament.id}/join`, {}), ctx)).status).toBe(401)
    expect((await CHECKIN(req('PATCH', `http://localhost/api/tournaments/${tournament.id}/checkin`, {}), ctx)).status).toBe(401)

    await prisma.tournament.delete({ where: { id: tournament.id } })
    await prisma.ruleset.delete({ where: { id: ruleset.id } })
    await prisma.user.delete({ where: { id: organizer.id } })
  })
})
