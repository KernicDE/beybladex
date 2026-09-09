// tests/integration/score-authz.test.ts
// Phase 5 Part C — judge-score authorization (standing Global-Constraints rule: every
// state-changing route documents its authz rule and has a negative test). Only the match's
// ASSIGNED judge, the tournament's creator, or an ADMIN may POST; anyone else — including a
// JUDGE-role user assigned to a DIFFERENT match — gets 403. Integration — CI-only (Postgres/Redis).
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

const SPIN_P1 = { event: { type: 'SPIN', player: 1 }, scorePlayer1: 1, scorePlayer2: 0 }

describe('match score authorization', () => {
  afterEach(() => mockAuth.mockReset())

  it('rejects a non-assigned user (even a JUDGE) with 403; assigned judge, owner and ADMIN may POST', async () => {
    const suffix = Date.now().toString(36)
    const owner = await prisma.user.create({ data: { username: `sa_own_${suffix}`, passwordHash: 'x', role: 'ORGANIZER' } })
    const admin = await prisma.user.create({ data: { username: `sa_adm_${suffix}`, passwordHash: 'x', role: 'ADMIN' } })
    const judge = await prisma.user.create({ data: { username: `sa_jdg_${suffix}`, passwordHash: 'x', role: 'JUDGE' } })
    const otherJudge = await prisma.user.create({ data: { username: `sa_ojd_${suffix}`, passwordHash: 'x', role: 'JUDGE' } })
    const randomUser = await prisma.user.create({ data: { username: `sa_rnd_${suffix}`, passwordHash: 'x' } })
    const p1 = await prisma.user.create({ data: { username: `sa_p1_${suffix}`, passwordHash: 'x' } })
    const p2 = await prisma.user.create({ data: { username: `sa_p2_${suffix}`, passwordHash: 'x' } })
    const ruleset = await prisma.ruleset.create({ data: { title: `SA ${suffix}`, slug: `sa-${suffix}`, createdById: owner.id } })
    const tournament = await prisma.tournament.create({
      data: {
        title: `SA T ${suffix}`,
        description: '',
        startDate: new Date(Date.now() + 86400_000),
        locationName: 'Arena',
        postalCode: '10115',
        city: 'Berlin',
        state: 'Berlin',
        latitude: 52.52,
        longitude: 13.405,
        rulesetId: ruleset.id,
        createdById: owner.id,
      },
    })
    // Phase 5 Part C2: every Match requires a stage; a lone SINGLE_ELIMINATION stage makes this
    // match the stage final (same finals-detection semantics as the pre-stage behavior).
    const stage = await prisma.tournamentStage.create({
      data: { tournamentId: tournament.id, order: 1, name: 'Hauptbracket', format: 'SINGLE_ELIMINATION' },
    })
    const match = await prisma.match.create({
      data: { tournamentId: tournament.id, stageId: stage.id, judgeId: judge.id, player1Id: p1.id, player2Id: p2.id, round: 1, bracketOrder: 0, status: 'IN_PROGRESS' },
    })
    const ctx = { params: Promise.resolve({ id: match.id }) }

    // Unauthenticated → 401
    mockAuth.mockResolvedValue(asSession(null))
    expect((await SCORE(req({ clientEventId: `sa-${suffix}-0`, ...SPIN_P1 }), ctx)).status).toBe(401)

    // A JUDGE assigned to a different match → 403 (role alone is not authorization)
    mockAuth.mockResolvedValue(asSession({ id: otherJudge.id, name: otherJudge.username }))
    const byOtherJudge = await SCORE(req({ clientEventId: `sa-${suffix}-1`, ...SPIN_P1 }), ctx)
    expect(byOtherJudge.status).toBe(403)

    // A plain user → 403
    mockAuth.mockResolvedValue(asSession({ id: randomUser.id, name: randomUser.username }))
    expect((await SCORE(req({ clientEventId: `sa-${suffix}-2`, ...SPIN_P1 }), ctx)).status).toBe(403)

    // No score was applied by any of the rejected attempts
    let row = await prisma.match.findUnique({ where: { id: match.id } })
    expect(row).toMatchObject({ scorePlayer1: 0, scorePlayer2: 0, clientEventId: null })

    // The ASSIGNED judge → 200
    mockAuth.mockResolvedValue(asSession({ id: judge.id, name: judge.username }))
    expect((await SCORE(req({ clientEventId: `sa-${suffix}-3`, ...SPIN_P1 }), ctx)).status).toBe(200)

    // The tournament owner (ORGANIZER role, createdById) → 200 (replay-safe: different event)
    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    expect((await SCORE(req({ clientEventId: `sa-${suffix}-4`, event: { type: 'SPIN', player: 2 }, scorePlayer1: 1, scorePlayer2: 1 }), ctx)).status).toBe(200)

    // An ADMIN → 200
    mockAuth.mockResolvedValue(asSession({ id: admin.id, name: admin.username }))
    expect((await SCORE(req({ clientEventId: `sa-${suffix}-5`, event: { type: 'SPIN', player: 1 }, scorePlayer1: 2, scorePlayer2: 1 }), ctx)).status).toBe(200)

    row = await prisma.match.findUnique({ where: { id: match.id } })
    expect(row).toMatchObject({ scorePlayer1: 2, scorePlayer2: 1 })

    await prisma.match.delete({ where: { id: match.id } })
    await prisma.tournamentStage.delete({ where: { id: stage.id } })
    await prisma.tournament.delete({ where: { id: tournament.id } })
    await prisma.ruleset.delete({ where: { id: ruleset.id } })
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, admin.id, judge.id, otherJudge.id, randomUser.id, p1.id, p2.id] } } })
  })
})
