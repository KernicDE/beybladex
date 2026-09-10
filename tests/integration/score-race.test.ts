// tests/integration/score-race.test.ts
// [RC2 #41] Two CONCURRENT score submissions with DIFFERENT clientEventIds for the same match:
// both pass the replay/COMPLETED checks (each reads the pre-update row), so only the conditional
// write (updateMany guarded by the clientEventId read in the route) decides who applies. The
// winner's completion runs Standings + Elo propagation exactly ONCE — the loser must not double-
// apply wins/losses or the Elo delta. Asserts the exact Elo math (1000 vs 1000, K=40 → 1020/980)
// so a double application would fail loudly. Integration — CI-only (Postgres/Redis).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { POST as SCORE } from '@/app/api/matches/[id]/score/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

function req(body: unknown) {
  return new Request('http://localhost/api/matches/x/score', { method: 'POST', body: JSON.stringify(body) })
}

describe('match score concurrent submissions', () => {
  afterEach(() => mockAuth.mockReset())

  it('applies standings and Elo exactly once when two different clientEventIds race a completion', async () => {
    const suffix = Date.now().toString(36)
    const organizer = await prisma.user.create({ data: { username: `sr_org_${suffix}`, passwordHash: 'x', role: 'ORGANIZER' } })
    const judge = await prisma.user.create({ data: { username: `sr_jdg_${suffix}`, passwordHash: 'x', role: 'JUDGE' } })
    const p1 = await prisma.user.create({ data: { username: `sr_p1_${suffix}`, passwordHash: 'x' } })
    const p2 = await prisma.user.create({ data: { username: `sr_p2_${suffix}`, passwordHash: 'x' } })
    const ruleset = await prisma.ruleset.create({
      data: { title: `SR ${suffix}`, slug: `sr-${suffix}`, createdById: organizer.id, targetPoints: 1, finalsTargetPoints: 5 },
    })
    const tournament = await prisma.tournament.create({
      data: {
        title: `SR T ${suffix}`,
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
    // SWISS stage: completion propagates via recordSwissResult (StageStanding) — the exact path
    // that used to double-apply. targetPoints=1, so one SPIN completes the match.
    const stage = await prisma.tournamentStage.create({
      data: { tournamentId: tournament.id, order: 1, name: 'Schweizer System', format: 'SWISS' },
    })
    await prisma.stageStanding.create({ data: { stageId: stage.id, userId: p1.id } })
    await prisma.stageStanding.create({ data: { stageId: stage.id, userId: p2.id } })
    const match = await prisma.match.create({
      data: { tournamentId: tournament.id, stageId: stage.id, judgeId: judge.id, player1Id: p1.id, player2Id: p2.id, round: 1, bracketOrder: 0, status: 'IN_PROGRESS' },
    })
    const season = await prisma.season.create({
      data: { name: `SR Season ${suffix}`, startsAt: new Date(Date.now() - 86400_000), endsAt: new Date(Date.now() + 86400_000), status: 'ACTIVE' },
    })
    const ctx = { params: Promise.resolve({ id: match.id }) }
    mockAuth.mockResolvedValue(asSession({ id: judge.id, name: judge.username }))

    // Two judges' submissions racing with DIFFERENT clientEventIds, both claiming the same 1-0
    // completing SPIN. Fired without awaiting between them: both reads happen before either
    // transaction commits, so the conditional write — not the pre-checks — decides the winner.
    const submission = (evt: string) => SCORE(req({ clientEventId: evt, event: { type: 'SPIN', player: 1 }, scorePlayer1: 1, scorePlayer2: 0 }), ctx)
    const [rA, rB] = await Promise.all([submission(`sr-${suffix}-A`), submission(`sr-${suffix}-B`)])

    // Exactly one applies (200 COMPLETED), the other loses the race → 409 conflict. Which one
    // wins is scheduler-dependent; the persisted state must be identical either way.
    const statuses = [rA.status, rB.status].sort()
    expect(statuses).toEqual([200, 409])
    const winner = rA.status === 200 ? rA : rB
    expect(await winner.json()).toMatchObject({ status: 'COMPLETED', winnerId: p1.id, scorePlayer1: 1, scorePlayer2: 0 })
    const loser = rA.status === 409 ? rA : rB
    expect((await loser.json()).error).toBe('conflict')

    // Standings applied exactly once: 1-0, one opponent each — a double application would give
    // wins/losses of 2 and a duplicated opponentIds entry.
    const s1 = await prisma.stageStanding.findUnique({ where: { stageId_userId: { stageId: stage.id, userId: p1.id } } })
    const s2 = await prisma.stageStanding.findUnique({ where: { stageId_userId: { stageId: stage.id, userId: p2.id } } })
    expect(s1).toMatchObject({ wins: 1, losses: 0, opponentIds: [p2.id] })
    expect(s2).toMatchObject({ wins: 0, losses: 1, opponentIds: [p1.id] })

    // Elo applied exactly once: 1000 vs 1000, K=40 (first 30 games) → winner 1020, loser 980.
    // A second application would show gamesPlayed 2 and elo 1040/960-ish chained values.
    const ratings = await prisma.playerRating.findMany({ where: { seasonId: season.id, userId: { in: [p1.id, p2.id] } } })
    expect(ratings).toHaveLength(2)
    const byUser = new Map(ratings.map((r) => [r.userId, r]))
    expect(byUser.get(p1.id)).toMatchObject({ elo: 1020, gamesPlayed: 1 })
    expect(byUser.get(p2.id)).toMatchObject({ elo: 980, gamesPlayed: 1 })

    // The match row records exactly one clientEventId — the loser's event was never written.
    const row = await prisma.match.findUnique({ where: { id: match.id } })
    expect(row).toMatchObject({ status: 'COMPLETED', scorePlayer1: 1, scorePlayer2: 0, winnerId: p1.id })
    expect([`sr-${suffix}-A`, `sr-${suffix}-B`]).toContain(row!.clientEventId)

    // Sequential follow-up: a replay of the applied event is a no-op; a new event is a 409.
    const replay = await SCORE(req({ clientEventId: row!.clientEventId, event: { type: 'SPIN', player: 1 }, scorePlayer1: 1, scorePlayer2: 0 }), ctx)
    expect((await replay.json()).replayed).toBe(true)
    const conflict = await SCORE(req({ clientEventId: `sr-${suffix}-C`, event: { type: 'SPIN', player: 2 }, scorePlayer1: 1, scorePlayer2: 1 }), ctx)
    expect(conflict.status).toBe(409)

    await prisma.playerRating.deleteMany({ where: { seasonId: season.id } })
    await prisma.season.delete({ where: { id: season.id } })
    await prisma.match.delete({ where: { id: match.id } })
    await prisma.stageStanding.deleteMany({ where: { stageId: stage.id } })
    await prisma.tournamentStage.delete({ where: { id: stage.id } })
    await prisma.tournament.delete({ where: { id: tournament.id } })
    await prisma.ruleset.delete({ where: { id: ruleset.id } })
    await prisma.user.deleteMany({ where: { id: { in: [organizer.id, judge.id, p1.id, p2.id] } } })
  })
})
