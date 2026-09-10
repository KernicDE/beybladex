// tests/integration/ranked-eligibility.test.ts (Phase 14)
// Integration — CI-only (Postgres/Redis). Covers the score route's Elo hook: a completed match
// in a rankedEligible: false tournament must not create/update any PlayerRating; a
// rankedEligible: true tournament (the default) does. Also covers the ladder's own
// minimum-games gate end to end (a player under MIN_RATED_GAMES_FOR_LADDER is excluded from a
// query using the same filter the /rangliste page applies).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { POST } from '@/app/api/matches/[id]/score/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'
import { MIN_RATED_GAMES_FOR_LADDER } from '@/lib/elo'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn().mockResolvedValue({ allowed: true }) }))
vi.mock('@/lib/arenaAssign', () => ({ assignFreedArena: vi.fn() }))
vi.mock('@/lib/metaCache', () => ({ markMetaDirty: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

async function seedUser(suffix: string, prefix: string) {
  return prisma.user.create({ data: { username: `${prefix}_${suffix}`, passwordHash: 'x', role: 'JUDGE' } })
}

async function seedRuleset(suffix: string, ownerId: string) {
  return prisma.ruleset.create({
    data: { title: `RS ${suffix}`, slug: `rs-${suffix}`, isPublic: true, targetPoints: 3, finalsTargetPoints: 3, createdById: ownerId },
  })
}

async function seedTournamentWithMatch(suffix: string, ownerId: string, rulesetId: string, player1Id: string, player2Id: string, rankedEligible: boolean) {
  const tournament = await prisma.tournament.create({
    data: {
      title: `T ${suffix}`, description: '', startDate: new Date(), locationName: 'X',
      postalCode: '10115', city: 'Berlin', state: 'Berlin', latitude: 52.52, longitude: 13.4,
      rulesetId, createdById: ownerId, rankedEligible,
    },
  })
  const stage = await prisma.tournamentStage.create({
    data: { tournamentId: tournament.id, order: 1, name: 'Stage', format: 'SINGLE_ELIMINATION', status: 'ACTIVE' },
  })
  const match = await prisma.match.create({
    data: { tournamentId: tournament.id, stageId: stage.id, round: 1, bracketOrder: 0, player1Id, player2Id, judgeId: ownerId, status: 'IN_PROGRESS' },
  })
  return { tournament, stage, match }
}

function scoreBody(overrides: Record<string, unknown>) {
  return new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(overrides) })
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('ranked eligibility', () => {
  it('a completed match in a rankedEligible: false tournament does not touch PlayerRating', async () => {
    const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const owner = await seedUser(suffix, 'rnowo')
    const p1 = await seedUser(suffix, 'rnop1')
    const p2 = await seedUser(suffix, 'rnop2')
    const ruleset = await seedRuleset(suffix, owner.id)
    const season = await prisma.season.create({
      data: { name: `S ${suffix}`, startsAt: new Date(), endsAt: new Date(Date.now() + 86400_000), status: 'ACTIVE' },
    })
    const { match } = await seedTournamentWithMatch(suffix, owner.id, ruleset.id, p1.id, p2.id, false)

    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    // Push p1 to the win threshold (targetPoints=3) via three SPIN events.
    let scores = { scorePlayer1: 0, scorePlayer2: 0 }
    for (let i = 0; i < 3; i++) {
      scores = { scorePlayer1: scores.scorePlayer1 + 1, scorePlayer2: scores.scorePlayer2 }
      const res = await POST(
        scoreBody({ clientEventId: `evt-${suffix}-${i}`, event: { type: 'SPIN', player: 1 }, ...scores, status: 'IN_PROGRESS' }),
        { params: Promise.resolve({ id: match.id }) }
      )
      expect(res.status).toBe(200)
    }

    const rating = await prisma.playerRating.findUnique({ where: { seasonId_userId: { seasonId: season.id, userId: p1.id } } })
    expect(rating).toBeNull()
  })

  it('a completed match in a rankedEligible: true tournament (default) updates both PlayerRating rows', async () => {
    const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const owner = await seedUser(suffix, 'rywo')
    const p1 = await seedUser(suffix, 'ryp1')
    const p2 = await seedUser(suffix, 'ryp2')
    const ruleset = await seedRuleset(suffix, owner.id)
    const season = await prisma.season.create({
      data: { name: `S2 ${suffix}`, startsAt: new Date(), endsAt: new Date(Date.now() + 86400_000), status: 'ACTIVE' },
    })
    const { match } = await seedTournamentWithMatch(suffix, owner.id, ruleset.id, p1.id, p2.id, true)

    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    let scores = { scorePlayer1: 0, scorePlayer2: 0 }
    for (let i = 0; i < 3; i++) {
      scores = { scorePlayer1: scores.scorePlayer1 + 1, scorePlayer2: scores.scorePlayer2 }
      await POST(
        scoreBody({ clientEventId: `evt2-${suffix}-${i}`, event: { type: 'SPIN', player: 1 }, ...scores, status: 'IN_PROGRESS' }),
        { params: Promise.resolve({ id: match.id }) }
      )
    }

    const winnerRating = await prisma.playerRating.findUnique({ where: { seasonId_userId: { seasonId: season.id, userId: p1.id } } })
    const loserRating = await prisma.playerRating.findUnique({ where: { seasonId_userId: { seasonId: season.id, userId: p2.id } } })
    expect(winnerRating?.elo).toBe(1020) // provisional K=40, equal 1000 start → +20
    expect(winnerRating?.gamesPlayed).toBe(1)
    expect(loserRating?.elo).toBe(980)
    expect(loserRating?.gamesPlayed).toBe(1)
  })

  it('ladder visibility: a player under the minimum-games threshold is excluded, at-threshold is included', async () => {
    const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const season = await prisma.season.create({
      data: { name: `Ladder ${suffix}`, startsAt: new Date(), endsAt: new Date(Date.now() + 86400_000), status: 'ACTIVE' },
    })
    const below = await prisma.user.create({ data: { username: `ldbelow_${suffix}`, passwordHash: 'x' } })
    const at = await prisma.user.create({ data: { username: `ldat_${suffix}`, passwordHash: 'x' } })
    await prisma.playerRating.create({ data: { seasonId: season.id, userId: below.id, elo: 1100, gamesPlayed: MIN_RATED_GAMES_FOR_LADDER - 1 } })
    await prisma.playerRating.create({ data: { seasonId: season.id, userId: at.id, elo: 1050, gamesPlayed: MIN_RATED_GAMES_FOR_LADDER } })

    const ladder = await prisma.playerRating.findMany({
      where: { seasonId: season.id, gamesPlayed: { gte: MIN_RATED_GAMES_FOR_LADDER } },
      select: { userId: true },
    })
    expect(ladder.map((r) => r.userId)).toContain(at.id)
    expect(ladder.map((r) => r.userId)).not.toContain(below.id)
  })
})
