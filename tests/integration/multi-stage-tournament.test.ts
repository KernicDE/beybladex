// tests/integration/multi-stage-tournament.test.ts
// Phase 5 Part C2 — the acceptance-critical end-to-end journey: a tournament runs a SWISS stage
// (3 rounds, qualifyCount 4) followed by a DOUBLE_ELIMINATION stage, and ONLY the Swiss stage's
// top-4 finishers enter the double-elimination bracket. Exercises: stage creation, Swiss pairing
// via the generate route, scoring through the real score route (stage-scoped, no finals target),
// the round_incomplete / swiss_complete 409 guards, stage completion (ranking + qualifiers), the
// qualification GATE (generating the DE stage before completion → empty pool → 422), and the DE
// bracket containing exactly the 4 qualifiers. Integration — CI-only (Postgres/Redis).
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

describe('multi-stage tournament: Swiss → top-4 → Double-Elimination', () => {
  afterEach(() => mockAuth.mockReset())

  it('Swiss stage runs to completion and its qualifyCount gates the DE stage pool', async () => {
    const suffix = Date.now().toString(36)
    const owner = await prisma.user.create({ data: { username: `ms_own_${suffix}`, passwordHash: 'x', role: 'ORGANIZER' } })
    const ruleset = await prisma.ruleset.create({
      // targetPoints 1: a single SPIN completes a match — keeps the scripted scoring to one
      // POST per match. finalsTargetPoints is irrelevant for Swiss rounds (Part C2 rule).
      data: { title: `MS ${suffix}`, slug: `ms-${suffix}`, createdById: owner.id, targetPoints: 1, finalsTargetPoints: 2 },
    })
    const tournament = await prisma.tournament.create({
      data: {
        title: `MS T ${suffix}`, description: '', startDate: new Date(Date.now() + 86400_000),
        locationName: 'Arena', postalCode: '10115', city: 'Berlin', state: 'Berlin',
        latitude: 52.52, longitude: 13.405, rulesetId: ruleset.id, createdById: owner.id,
      },
    })
    const players: { id: string }[] = []
    for (let i = 1; i <= 6; i++) {
      players.push(await prisma.user.create({ data: { username: `ms_p${i}_${suffix}`, passwordHash: 'x' } }))
      await prisma.tournamentParticipant.create({ data: { tournamentId: tournament.id, userId: players[i - 1].id, checkedIn: true } })
    }
    const base = `http://localhost/api/tournaments/${tournament.id}`
    const ctx = { params: Promise.resolve({ id: tournament.id }) }
    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))

    // Stages: Swiss (order 1, 3 rounds, top 4 advance) → Double-Elimination (order 2).
    const swissRes = await CREATE_STAGE(req('POST', `${base}/stages`, { name: 'Vorrunde', format: 'SWISS', swissRounds: 3, qualifyCount: 4 }), ctx)
    expect(swissRes.status).toBe(201)
    const { id: swissId } = (await swissRes.json()) as { id: string }
    const deRes = await CREATE_STAGE(req('POST', `${base}/stages`, { name: 'Playoffs', format: 'DOUBLE_ELIMINATION' }), ctx)
    const { id: deId } = (await deRes.json()) as { id: string }
    const swissCtx = { params: Promise.resolve({ id: tournament.id, stageId: swissId }) }
    const deCtx = { params: Promise.resolve({ id: tournament.id, stageId: deId }) }

    // THE GATE: the DE stage's pool comes from the previous stage's qualifiedUserIds — before
    // the Swiss stage completes there are none, so generation must refuse (422).
    expect((await GENERATE(req('POST', `${base}/stages/${deId}/generate`), deCtx)).status).toBe(422)

    // — Run all 3 Swiss rounds through the real score route (player1 always wins) ————————
    let eventSeq = 0
    const scoreOpenSwissMatches = async () => {
      const open = await prisma.match.findMany({ where: { stageId: swissId, status: { in: ['PENDING', 'IN_PROGRESS'] } } })
      expect(open.length).toBeGreaterThan(0)
      for (const m of open) {
        const res = await SCORE(
          req('POST', `http://localhost/api/matches/${m.id}/score`, {
            clientEventId: `ms-${suffix}-${eventSeq++}`,
            event: { type: 'SPIN', player: 1 },
            scorePlayer1: 1,
            scorePlayer2: 0,
          }),
          { params: Promise.resolve({ id: m.id }) }
        )
        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body).toMatchObject({ status: 'COMPLETED', winnerId: m.player1Id, targetPoints: 1 })
      }
    }

    for (let round = 1; round <= 3; round++) {
      const gen = await GENERATE(req('POST', `${base}/stages/${swissId}/generate`), swissCtx)
      expect(gen.status).toBe(201)
      // A re-generate before the round is scored is refused (round_incomplete).
      expect((await GENERATE(req('POST', `${base}/stages/${swissId}/generate`), swissCtx)).status).toBe(409)
      await scoreOpenSwissMatches()
    }
    expect((await GENERATE(req('POST', `${base}/stages/${swissId}/generate`), swissCtx)).status).toBe(409) // swiss_complete

    // — Complete the Swiss stage: ranking + qualifiers ————————————————————————————
    const complete = await COMPLETE_STAGE(req('POST', `${base}/stages/${swissId}/complete`), swissCtx)
    expect(complete.status).toBe(200)
    const { ranking, qualified } = (await complete.json()) as { ranking: string[]; qualified: string[] }
    expect(ranking).toHaveLength(6)
    expect(qualified).toHaveLength(4)
    expect(qualified).toEqual(ranking.slice(0, 4))
    // Every qualifier is a checked-in participant; the standings recorded real wins.
    const swissStage = await prisma.tournamentStage.findUnique({ where: { id: swissId } })
    expect(swissStage!.status).toBe('COMPLETED')
    expect(qualified.every((id) => players.some((p) => p.id === id))).toBe(true)
    const championStanding = await prisma.stageStanding.findUnique({ where: { stageId_userId: { stageId: swissId, userId: ranking[0] } } })
    expect(championStanding!.wins).toBe(3)

    // — The DE stage now generates EXACTLY the 4 qualifiers ———————————————————————————
    const deGen = await GENERATE(req('POST', `${base}/stages/${deId}/generate`), deCtx)
    expect(deGen.status).toBe(201)
    expect((await deGen.json()).created).toBe(7) // WB 3 + LB 2 + grand final + reset (4 players, R=2)
    const deMatches = await prisma.match.findMany({ where: { stageId: deId } })
    const dePlayers = new Set(deMatches.flatMap((m) => [m.player1Id, m.player2Id].filter((x): x is string => x !== null)))
    expect(dePlayers).toEqual(new Set(qualified))
    // The two non-qualifiers appear NOWHERE in the playoff stage.
    const nonQualifiers = players.map((p) => p.id).filter((id) => !qualified.includes(id))
    expect(nonQualifiers.every((id) => !dePlayers.has(id))).toBe(true)
    // Round-1 winners-bracket matches are the qualifiers, seeded ascending userId.
    const wbR1 = deMatches.filter((m) => m.bracketSide === 'WINNERS' && m.round === 1).sort((a, b) => a.bracketOrder - b.bracketOrder)
    const seeded = [...qualified].sort()
    expect(wbR1[0]).toMatchObject({ player1Id: seeded[0], player2Id: seeded[1] })
    expect(wbR1[1]).toMatchObject({ player1Id: seeded[2], player2Id: seeded[3] })
    // The grand-final reset node exists PENDING (the conditional match).
    const reset = deMatches.find((m) => m.bracketSide === 'GRAND_FINAL' && m.bracketOrder === 1)
    expect(reset).toMatchObject({ status: 'PENDING', player1Id: null, player2Id: null })

    await prisma.match.deleteMany({ where: { tournamentId: tournament.id } })
    await prisma.stageStanding.deleteMany({ where: { stage: { tournamentId: tournament.id } } })
    await prisma.tournamentStage.deleteMany({ where: { tournamentId: tournament.id } })
    await prisma.tournamentParticipant.deleteMany({ where: { tournamentId: tournament.id } })
    await prisma.tournament.delete({ where: { id: tournament.id } })
    await prisma.ruleset.delete({ where: { id: ruleset.id } })
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, ...players.map((p) => p.id)] } } })
  })
})
