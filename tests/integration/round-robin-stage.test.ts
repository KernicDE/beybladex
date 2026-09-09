// tests/integration/round-robin-stage.test.ts
// Phase 5 Part C3 — Round Robin end-to-end: a 5-participant ROUND_ROBIN stage generates the full
// circle-method fixture list in one shot (C(5,2) = 10 matches), every match is scored through the
// real score route (always at targetPoints — never finalsTargetPoints, there is no "final" in a
// round robin), and completion produces the StageStanding-based ranking + qualifyCount gate —
// the same machinery Swiss uses. Negatives: roundRobinRepeats outside 1–3 is 400, a second
// generate is 409 (bracket_exists), completing with open matches is 409 (matches_open). The
// authz negatives for these routes live in tests/integration/stage-authz.test.ts (format-
// independent, per the standing Global-Constraints rule). Integration — CI-only (Postgres/Redis).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { POST as CREATE_STAGE } from '@/app/api/tournaments/[id]/stages/route'
import { POST as GENERATE } from '@/app/api/tournaments/[id]/stages/[stageId]/generate/route'
import { POST as COMPLETE_STAGE } from '@/app/api/tournaments/[id]/stages/[stageId]/complete/route'
import { POST as SCORE } from '@/app/api/matches/[id]/score/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}
function req(method: string, url: string, body?: unknown) {
  return new Request(url, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
}

describe('round-robin stage: generate → score → complete', () => {
  afterEach(() => mockAuth.mockReset())

  it('5 participants play C(5,2)=10 matches; completion ranks by standings; negatives 409', async () => {
    const suffix = Date.now().toString(36)
    const owner = await prisma.user.create({ data: { username: `rr_own_${suffix}`, passwordHash: 'x', role: 'ORGANIZER' } })
    const ruleset = await prisma.ruleset.create({
      // targetPoints 1, finalsTargetPoints 2: a single SPIN at targetPoints completes a match —
      // if the score route wrongly treated the last round-robin round as a "final" (2 points),
      // matches would stay IN_PROGRESS and this test would fail at completion. That is the
      // acceptance criterion "every ROUND_ROBIN score uses targetPoints, never finalsTargetPoints".
      data: { title: `RR ${suffix}`, slug: `rr-${suffix}`, createdById: owner.id, targetPoints: 1, finalsTargetPoints: 2 },
    })
    const tournament = await prisma.tournament.create({
      data: {
        title: `RR T ${suffix}`, description: '', startDate: new Date(Date.now() + 86400_000),
        locationName: 'Arena', postalCode: '10115', city: 'Berlin', state: 'Berlin',
        latitude: 52.52, longitude: 13.405, rulesetId: ruleset.id, createdById: owner.id,
      },
    })
    const players: { id: string }[] = []
    for (let i = 1; i <= 5; i++) {
      players.push(await prisma.user.create({ data: { username: `rr_p${i}_${suffix}`, passwordHash: 'x' } }))
      await prisma.tournamentParticipant.create({ data: { tournamentId: tournament.id, userId: players[i - 1].id, checkedIn: true } })
    }
    // Scripted results: the lower-numbered player always wins → final record p1 4-0, p2 3-1,
    // p3 2-2, p4 1-3, p5 0-4 — a fully deterministic expected ranking.
    const indexOf = new Map(players.map((p, i) => [p.id, i]))
    const scriptedWinner = (m: { player1Id: string | null; player2Id: string | null }) =>
      indexOf.get(m.player1Id!)! < indexOf.get(m.player2Id!)! ? 1 : 2

    const base = `http://localhost/api/tournaments/${tournament.id}`
    const ctx = { params: Promise.resolve({ id: tournament.id }) }
    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))

    // roundRobinRepeats outside 1–3 is rejected; the stage itself is created with qualifyCount 3.
    expect((await CREATE_STAGE(req('POST', `${base}/stages`, { name: 'Vorrunde', format: 'ROUND_ROBIN', roundRobinRepeats: 4 }), ctx)).status).toBe(400)
    expect((await CREATE_STAGE(req('POST', `${base}/stages`, { name: 'Vorrunde', format: 'ROUND_ROBIN', roundRobinRepeats: 0 }), ctx)).status).toBe(400)
    const create = await CREATE_STAGE(req('POST', `${base}/stages`, { name: 'Vorrunde', format: 'ROUND_ROBIN', qualifyCount: 3 }), ctx)
    expect(create.status).toBe(201)
    const { id: stageId } = (await create.json()) as { id: string }
    const stageCtx = { params: Promise.resolve({ id: tournament.id, stageId }) }
    const stageRow = await prisma.tournamentStage.findUnique({ where: { id: stageId } })
    expect(stageRow).toMatchObject({ format: 'ROUND_ROBIN', roundRobinRepeats: null, qualifyCount: 3 })

    // — Generate the full fixture list in ONE shot ————————————————————————————————
    const gen = await GENERATE(req('POST', `${base}/stages/${stageId}/generate`), stageCtx)
    expect(gen.status).toBe(201)
    expect((await gen.json()).created).toBe(10) // C(5,2) = 10, repeats default 1
    const matches = await prisma.match.findMany({ where: { stageId } })
    expect(matches).toHaveLength(10)
    // 5 rounds × 2 matches; every round number 1..5 present exactly twice.
    const perRound = new Map<number, number>()
    for (const m of matches) perRound.set(m.round, (perRound.get(m.round) ?? 0) + 1)
    expect([...perRound.entries()].sort((a, b) => a[0] - b[0])).toEqual([[1, 2], [2, 2], [3, 2], [4, 2], [5, 2]])
    expect(matches.every((m) => m.swissRound === m.round && m.status === 'PENDING' && m.bracketSide === null)).toBe(true)

    // NEGATIVE: a second generate is refused (one-shot fixture list, unlike Swiss's per-round).
    expect((await GENERATE(req('POST', `${base}/stages/${stageId}/generate`), stageCtx)).status).toBe(409) // bracket_exists
    // NEGATIVE: completing with open matches is refused (elimination-style all-COMPLETED gate).
    expect((await COMPLETE_STAGE(req('POST', `${base}/stages/${stageId}/complete`), stageCtx)).status).toBe(409) // matches_open

    // — Score every match through the real score route (scripted winner always wins) ————————
    let eventSeq = 0
    for (const m of matches) {
      const winner = scriptedWinner(m)
      const res = await SCORE(
        req('POST', `http://localhost/api/matches/${m.id}/score`, {
          clientEventId: `rr-${suffix}-${eventSeq++}`,
          event: { type: 'SPIN', player: winner },
          scorePlayer1: winner === 1 ? 1 : 0,
          scorePlayer2: winner === 2 ? 1 : 0,
        }),
        { params: Promise.resolve({ id: m.id }) }
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body).toMatchObject({ status: 'COMPLETED', targetPoints: 1 }) // never finalsTargetPoints (2)
    }

    // Standings reflect the scripted records along the way (spot-check two players).
    const s1 = await prisma.stageStanding.findUnique({ where: { stageId_userId: { stageId, userId: players[0].id } } })
    const s5 = await prisma.stageStanding.findUnique({ where: { stageId_userId: { stageId, userId: players[4].id } } })
    expect(s1).toMatchObject({ wins: 4, losses: 0 })
    expect(s5).toMatchObject({ wins: 0, losses: 4 })

    // — Complete: StageStanding ranking (wins desc, buchholz desc, userId asc) + qualifiers ————
    const complete = await COMPLETE_STAGE(req('POST', `${base}/stages/${stageId}/complete`), stageCtx)
    expect(complete.status).toBe(200)
    const { ranking, qualified } = (await complete.json()) as { ranking: string[]; qualified: string[] }
    // No ties in the scripted records → the ranking is exactly p1..p5 in creation order.
    expect(ranking).toEqual(players.map((p) => p.id))
    expect(qualified).toEqual(ranking.slice(0, 3)) // qualifyCount gate, same machinery as Swiss
    const done = await prisma.tournamentStage.findUnique({ where: { id: stageId } })
    expect(done).toMatchObject({ status: 'COMPLETED', qualifiedUserIds: ranking.slice(0, 3) })

    await prisma.match.deleteMany({ where: { tournamentId: tournament.id } })
    await prisma.stageStanding.deleteMany({ where: { stage: { tournamentId: tournament.id } } })
    await prisma.tournamentStage.deleteMany({ where: { tournamentId: tournament.id } })
    await prisma.tournamentParticipant.deleteMany({ where: { tournamentId: tournament.id } })
    await prisma.tournament.delete({ where: { id: tournament.id } })
    await prisma.ruleset.delete({ where: { id: ruleset.id } })
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, ...players.map((p) => p.id)] } } })
  })
})
