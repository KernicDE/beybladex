// tests/integration/meta-recompute.test.ts
// Phase 5 Part D — dirty-set + recompute end to end: COMPLETED matches (seeded directly, plus
// ONE completed through the real score route to exercise the actual dirty-marking side effect)
// get marked dirty, recomputeDirtyMeta() recomputes exactly those ids, and the Redis-cached
// win rates match the hand-computed values. Asserts the MIN_APPEARANCES policy too: a build
// with 2 appearances caches winRate: null (the "Noch nicht genug Daten" marker), not a number.
// Integration — CI-only (real Postgres via Prisma, real Redis for the dirty set + cache).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { POST as SCORE } from '@/app/api/matches/[id]/score/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'
import { redis } from '@/lib/redis'
import { recomputeDirtyMeta, markMetaDirty, buildCacheKey, partCacheKey, DIRTY_BUILDS_KEY, DIRTY_PARTS_KEY } from '@/lib/metaCache'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

function req(body: unknown) {
  return new Request('http://localhost/api/matches/x/score', { method: 'POST', body: JSON.stringify(body) })
}

describe('Auto-Meta dirty-set recompute', () => {
  afterEach(() => mockAuth.mockReset())

  it('marks builds/parts dirty on completion (via the score route) and recomputeDirtyMeta caches the expected win rates', async () => {
    const suffix = Date.now().toString(36)
    const organizer = await prisma.user.create({ data: { username: `mt_org_${suffix}`, passwordHash: 'x', role: 'ORGANIZER' } })
    const judge = await prisma.user.create({ data: { username: `mt_jdg_${suffix}`, passwordHash: 'x', role: 'JUDGE' } })
    const p1 = await prisma.user.create({ data: { username: `mt_p1_${suffix}`, passwordHash: 'x' } })
    const opp = await prisma.user.create({ data: { username: `mt_opp_${suffix}`, passwordHash: 'x' } })

    // Parts/builds: main (reaches the threshold), opp (its opponent in every match), small
    // (stays below the threshold).
    const mk = (tag: string, cat: 'BLADE' | 'RATCHET' | 'BIT') =>
      prisma.part.create({ data: { name: `mt_${tag}_${suffix}`, category: cat, manufacturer: 'TT', spinDirection: 'RIGHT' } })
    const [bladeA, ratchetA, bitA, bladeB, ratchetB, bitB, bladeS, ratchetS, bitS] = await Promise.all([
      mk('bladea', 'BLADE'), mk('rata', 'RATCHET'), mk('bita', 'BIT'),
      mk('bladep', 'BLADE'), mk('ratp', 'RATCHET'), mk('bitp', 'BIT'),
      mk('blades', 'BLADE'), mk('rats', 'RATCHET'), mk('bits', 'BIT'),
    ])
    const buildMain = await prisma.build.create({ data: { bladeId: bladeA.id, ratchetId: ratchetA.id, bitId: bitA.id, type: 'ATTACK' } })
    const buildOpp = await prisma.build.create({ data: { bladeId: bladeB.id, ratchetId: ratchetB.id, bitId: bitB.id, type: 'DEFENSE' } })
    const buildSmall = await prisma.build.create({ data: { bladeId: bladeS.id, ratchetId: ratchetS.id, bitId: bitS.id, type: 'BALANCE' } })

    const ruleset = await prisma.ruleset.create({
      data: { title: `MT ${suffix}`, slug: `mt-${suffix}`, createdById: organizer.id, targetPoints: 3, finalsTargetPoints: 5 },
    })
    const tournament = await prisma.tournament.create({
      data: {
        title: `MT T ${suffix}`,
        description: '',
        startDate: new Date(Date.now() + 86400_000),
        locationName: 'Arena',
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
      data: { tournamentId: tournament.id, order: 1, name: 'Hauptbracket', format: 'SINGLE_ELIMINATION' },
    })

    // Seed 14 COMPLETED matches directly: buildMain goes 11-3 (the 15th match, a win, comes
    // through the real score route below → final record 12/3, win rate 0.8).
    const seeded: string[] = []
    for (let i = 0; i < 14; i++) {
      const mainWon = i < 11
      const m = await prisma.match.create({
        data: {
          tournamentId: tournament.id,
          stageId: stage.id,
          player1Id: p1.id,
          player2Id: opp.id,
          player1BuildId: buildMain.id,
          player2BuildId: buildOpp.id,
          status: 'COMPLETED',
          scorePlayer1: mainWon ? 3 : 0,
          scorePlayer2: mainWon ? 0 : 3,
          winnerId: mainWon ? p1.id : opp.id,
        },
      })
      seeded.push(m.id)
    }
    // buildSmall: 2 appearances (1-1) — below the MIN_APPEARANCES threshold.
    for (const mainWon of [true, false]) {
      const m = await prisma.match.create({
        data: {
          tournamentId: tournament.id,
          stageId: stage.id,
          player1Id: p1.id,
          player2Id: opp.id,
          player1BuildId: buildSmall.id,
          player2BuildId: buildOpp.id,
          status: 'COMPLETED',
          scorePlayer1: mainWon ? 3 : 0,
          scorePlayer2: mainWon ? 0 : 3,
          winnerId: mainWon ? p1.id : opp.id,
        },
      })
      seeded.push(m.id)
    }

    // The 15th main-build match goes through the REAL score route (IN_PROGRESS → COMPLETED),
    // which is what marks the builds/parts dirty. Round-2 placeholder keeps round 1 non-final
    // (targetPoints 3, not finalsTargetPoints 5 — same pattern as score-idempotency.test.ts).
    const liveMatch = await prisma.match.create({
      data: {
        tournamentId: tournament.id,
        stageId: stage.id,
        judgeId: judge.id,
        player1Id: p1.id,
        player2Id: opp.id,
        round: 1,
        bracketOrder: 0,
        status: 'IN_PROGRESS',
      },
    })
    const finalPlaceholder = await prisma.match.create({
      data: { tournamentId: tournament.id, stageId: stage.id, round: 2, bracketOrder: 0, status: 'PENDING' },
    })
    const ctx = { params: Promise.resolve({ id: liveMatch.id }) }
    mockAuth.mockResolvedValue(asSession({ id: judge.id, name: judge.username }))

    // Seed the dirty set for the directly-created matches (they never pass through the score
    // route, so nothing marked them yet). Everything is marked first; buildMain/buildOpp and
    // their parts are then removed so the assertions below can prove the score route ADDS
    // them on completion — and only on completion.
    await markMetaDirty(
      [buildMain.id, buildOpp.id, buildSmall.id],
      [bladeA.id, ratchetA.id, bitA.id, bladeB.id, ratchetB.id, bitB.id, bladeS.id, ratchetS.id, bitS.id],
    )
    await redis.srem(DIRTY_BUILDS_KEY, buildMain.id, buildOpp.id)
    await redis.srem(DIRTY_PARTS_KEY, bladeA.id, ratchetA.id, bitA.id, bladeB.id, ratchetB.id, bitB.id)

    // Non-completing score first: must NOT dirty anything (dirty marking is completion-only).
    const r1 = await SCORE(req({ clientEventId: `mt-${suffix}-1`, event: { type: 'SPIN', player: 1 }, scorePlayer1: 1, scorePlayer2: 0 }), ctx)
    expect(r1.status).toBe(200)
    expect(await redis.sismember(DIRTY_BUILDS_KEY, buildMain.id)).toBe(0)

    // Completing the match (SPIN + BURST = 1 + 2 = 3 = targetPoints): the route marks
    // buildMain/buildOpp and their parts dirty as a side effect.
    const r2 = await SCORE(
      req({
        clientEventId: `mt-${suffix}-2`,
        event: { type: 'BURST', player: 1 },
        scorePlayer1: 3,
        scorePlayer2: 0,
        player1BuildId: buildMain.id,
        player2BuildId: buildOpp.id,
      }),
      ctx,
    )
    expect(r2.status).toBe(200)
    expect(await r2.json()).toMatchObject({ status: 'COMPLETED', winnerId: p1.id })
    expect(await redis.sismember(DIRTY_BUILDS_KEY, buildMain.id)).toBe(1)
    expect(await redis.sismember(DIRTY_BUILDS_KEY, buildOpp.id)).toBe(1)
    expect(await redis.sismember(DIRTY_PARTS_KEY, bladeA.id)).toBe(1)
    expect(await redis.sismember(DIRTY_PARTS_KEY, bitB.id)).toBe(1)

    // Recompute pass: drains the dirty sets (atomically) and writes the cache entries.
    const result = await recomputeDirtyMeta()
    // Exact counts could include ids dirtied by a parallel test file sharing the CI Redis —
    // assert our ids were processed, not global exclusivity.
    expect(result.builds).toBeGreaterThanOrEqual(3)
    expect(result.parts).toBeGreaterThanOrEqual(9)
    expect(await redis.scard(DIRTY_BUILDS_KEY)).toBe(0) // drained — a concurrent SADD can't be lost (see popDirty)

    // buildMain: 12 wins / 3 losses → 0.8, cached as JSON under meta:build:{id}.
    const mainStats = JSON.parse((await redis.get(buildCacheKey(buildMain.id)))!)
    expect(mainStats).toMatchObject({ id: buildMain.id, wins: 12, losses: 3, appearances: 15, winRate: 0.8 })

    // buildSmall: 2 appearances — the explicit "not enough data" marker, not a misleading 50%.
    const smallStats = JSON.parse((await redis.get(buildCacheKey(buildSmall.id)))!)
    expect(smallStats).toMatchObject({ id: buildSmall.id, wins: 1, losses: 1, appearances: 2, winRate: null })

    // Part-level: bladeA is used by buildMain only → same 12/3 record; the transitively
    // dirty-marked ratchet/bit follow. bitB sits on buildOpp: 3 wins / 12 losses → 0.2.
    const bladeStats = JSON.parse((await redis.get(partCacheKey(bladeA.id)))!)
    expect(bladeStats).toMatchObject({ id: bladeA.id, wins: 12, losses: 3, appearances: 15, winRate: 0.8 })
    const bitBStats = JSON.parse((await redis.get(partCacheKey(bitB.id)))!)
    expect(bitBStats).toMatchObject({ id: bitB.id, wins: 3, losses: 12, appearances: 15, winRate: 0.2 })

    // A build with NO completed matches but a dirty entry caches explicit zeros (not absence).
    const buildIdle = await prisma.build.create({ data: { bladeId: bladeS.id, ratchetId: ratchetS.id, bitId: bitS.id, type: 'STAMINA' } })
    await markMetaDirty([buildIdle.id], [])
    await recomputeDirtyMeta()
    const idleStats = JSON.parse((await redis.get(buildCacheKey(buildIdle.id)))!)
    expect(idleStats).toMatchObject({ id: buildIdle.id, wins: 0, losses: 0, appearances: 0, winRate: null })

    // Cleanup: DB rows + this test's Redis keys (dirty sets were drained by the recompute).
    await redis.del(
      buildCacheKey(buildMain.id), buildCacheKey(buildOpp.id), buildCacheKey(buildSmall.id), buildCacheKey(buildIdle.id),
      partCacheKey(bladeA.id), partCacheKey(ratchetA.id), partCacheKey(bitA.id),
      partCacheKey(bladeB.id), partCacheKey(ratchetB.id), partCacheKey(bitB.id),
      partCacheKey(bladeS.id), partCacheKey(ratchetS.id), partCacheKey(bitS.id),
    )
    await prisma.match.deleteMany({ where: { id: { in: [...seeded, liveMatch.id, finalPlaceholder.id] } } })
    await prisma.tournamentStage.delete({ where: { id: stage.id } })
    await prisma.tournament.delete({ where: { id: tournament.id } })
    await prisma.ruleset.delete({ where: { id: ruleset.id } })
    await prisma.build.deleteMany({ where: { id: { in: [buildMain.id, buildOpp.id, buildSmall.id, buildIdle.id] } } })
    await prisma.part.deleteMany({ where: { id: { in: [bladeA.id, ratchetA.id, bitA.id, bladeB.id, ratchetB.id, bitB.id, bladeS.id, ratchetS.id, bitS.id] } } })
    await prisma.user.deleteMany({ where: { id: { in: [organizer.id, judge.id, p1.id, opp.id] } } })
  })
})
