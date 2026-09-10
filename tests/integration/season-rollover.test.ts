// tests/integration/season-rollover.test.ts (Phase 14)
// Integration — CI-only (Postgres). Covers POST /api/admin/seasons: the regression-to-mean
// formula applied correctly on season creation, and the previous season's frozen ratings left
// unchanged.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { POST } from '@/app/api/admin/seasons/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'
import { regressToMean } from '@/lib/elo'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

function post(body: unknown) {
  return new Request('http://localhost/api/admin/seasons', { method: 'POST', body: JSON.stringify(body) })
}

async function seedUser(suffix: string, prefix: string, role: 'USER' | 'ADMIN' = 'USER') {
  return prisma.user.create({ data: { username: `${prefix}_${suffix}`, passwordHash: 'x', role } })
}

// [FIX] Same Season-leak class as ranked-eligibility.test.ts: the admin seasons route enforces
// "at most one ACTIVE season" at the application level, so an un-cleaned-up ACTIVE Season row
// left behind by one test here makes a LATER test's own 201/409 expectation flaky depending on
// run order. onDelete: Cascade on PlayerRating.season means deleting the Season is enough.
const createdSeasonIds: string[] = []

afterEach(async () => {
  vi.clearAllMocks()
  if (createdSeasonIds.length) {
    await prisma.season.deleteMany({ where: { id: { in: createdSeasonIds } } })
    createdSeasonIds.length = 0
  }
})

describe('season rollover', () => {
  it('a non-ADMIN caller is 403', async () => {
    const suffix = Date.now().toString(36)
    const user = await seedUser(suffix, 'srnon')
    mockAuth.mockResolvedValue(asSession({ id: user.id, name: user.username }))
    const res = await POST(post({ name: 'S', startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 86400_000).toISOString() }))
    expect(res.status).toBe(403)
  })

  it('creating a new season regresses prior ratings toward the mean and leaves the old season frozen', async () => {
    const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const admin = await seedUser(suffix, 'sradm', 'ADMIN')
    const player = await seedUser(suffix, 'srply')

    const oldSeason = await prisma.season.create({
      data: { name: `Old ${suffix}`, startsAt: new Date(Date.now() - 86400_000), endsAt: new Date(), status: 'ACTIVE' },
    })
    createdSeasonIds.push(oldSeason.id)
    const oldRating = await prisma.playerRating.create({
      data: { seasonId: oldSeason.id, userId: player.id, elo: 1400, peakElo: 1450, gamesPlayed: 12 },
    })

    mockAuth.mockResolvedValue(asSession({ id: admin.id, name: admin.username }))
    const res = await POST(
      post({
        name: `New ${suffix}`,
        startsAt: new Date().toISOString(),
        endsAt: new Date(Date.now() + 30 * 86400_000).toISOString(),
        completePreviousSeasonId: oldSeason.id,
      })
    )
    expect(res.status).toBe(201)
    const newSeason = (await res.json()) as { id: string }
    createdSeasonIds.push(newSeason.id)

    // Old season is now COMPLETED and its rating row is untouched.
    const frozenOldSeason = await prisma.season.findUniqueOrThrow({ where: { id: oldSeason.id } })
    expect(frozenOldSeason.status).toBe('COMPLETED')
    const frozenOldRating = await prisma.playerRating.findUniqueOrThrow({ where: { id: oldRating.id } })
    expect(frozenOldRating.elo).toBe(1400)

    // New season seeded the player at the regressed value, gamesPlayed reset to 0.
    const newRating = await prisma.playerRating.findUniqueOrThrow({
      where: { seasonId_userId: { seasonId: newSeason.id, userId: player.id } },
    })
    expect(newRating.elo).toBe(regressToMean(1400))
    expect(newRating.gamesPlayed).toBe(0)
  })

  it('creating a season while one is already ACTIVE and unaccounted-for is a 409', async () => {
    const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const admin = await seedUser(suffix, 'srcon', 'ADMIN')
    const activeSeason = await prisma.season.create({
      data: { name: `Active ${suffix}`, startsAt: new Date(), endsAt: new Date(Date.now() + 86400_000), status: 'ACTIVE' },
    })
    createdSeasonIds.push(activeSeason.id)
    mockAuth.mockResolvedValue(asSession({ id: admin.id, name: admin.username }))
    const res = await POST(post({ name: 'Conflict', startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + 86400_000).toISOString() }))
    expect(res.status).toBe(409)
  })
})
