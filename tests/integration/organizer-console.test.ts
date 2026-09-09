// tests/integration/organizer-console.test.ts
// Phase 5 Part C — organizer console authz and effects (standing Global-Constraints rule:
// every state-changing route documents its authz rule and has a negative test). All console
// actions (bracket generate, judge assign, no-show, complete) are owner/ADMIN-only: a non-owner,
// non-admin user gets 403 on each. The owner's actions succeed: bracket generation persists the
// full single-elimination bracket, judge assignment sets Match.judgeId, a no-show marks the
// participant withdrawn and auto-advances the opponent into the next round's slot, and
// completing sets Tournament.completedAt. Integration — CI-only (Postgres/Redis).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { POST as GENERATE_BRACKET } from '@/app/api/tournaments/[id]/bracket/route'
import { PATCH as ASSIGN_JUDGE } from '@/app/api/tournaments/[id]/matches/[matchId]/judge/route'
import { POST as NOSHOW } from '@/app/api/tournaments/[id]/noshow/route'
import { POST as COMPLETE } from '@/app/api/tournaments/[id]/complete/route'
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

describe('organizer console', () => {
  afterEach(() => mockAuth.mockReset())

  it('rejects a non-owner non-admin with 403 on every console action; the owner runs the full journey', async () => {
    const suffix = Date.now().toString(36)
    const owner = await prisma.user.create({ data: { username: `oc_own_${suffix}`, passwordHash: 'x', role: 'ORGANIZER' } })
    const admin = await prisma.user.create({ data: { username: `oc_adm_${suffix}`, passwordHash: 'x', role: 'ADMIN' } })
    const judge = await prisma.user.create({ data: { username: `oc_jdg_${suffix}`, passwordHash: 'x', role: 'JUDGE' } })
    const intruder = await prisma.user.create({ data: { username: `oc_int_${suffix}`, passwordHash: 'x', role: 'JUDGE' } })
    const ruleset = await prisma.ruleset.create({ data: { title: `OC ${suffix}`, slug: `oc-${suffix}`, createdById: owner.id } })
    const tournament = await prisma.tournament.create({
      data: {
        title: `OC T ${suffix}`,
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
    // 4 players, all checked in (3 would be enough to prove byes, 4 keeps the math obvious).
    const players = []
    for (let i = 1; i <= 4; i++) {
      players.push(await prisma.user.create({ data: { username: `oc_p${i}_${suffix}`, passwordHash: 'x' } }))
      await prisma.tournamentParticipant.create({
        data: { tournamentId: tournament.id, userId: players[i - 1].id, checkedIn: true },
      })
    }

    const base = `http://localhost/api/tournaments/${tournament.id}`
    const ctx = { params: Promise.resolve({ id: tournament.id }) }

    // — Negative authz: a JUDGE-role intruder gets 403 on bracket-generate and no-show,
    //   401 unauthenticated, and cannot touch a match judge assignment either.
    mockAuth.mockResolvedValue(asSession({ id: intruder.id, name: intruder.username }))
    expect((await GENERATE_BRACKET(req('POST', `${base}/bracket`), ctx)).status).toBe(403)
    expect((await NOSHOW(req('POST', `${base}/noshow`, { userId: players[0].id }), ctx)).status).toBe(403)
    expect((await COMPLETE(req('POST', `${base}/complete`), ctx)).status).toBe(403)
    mockAuth.mockResolvedValue(asSession(null))
    expect((await GENERATE_BRACKET(req('POST', `${base}/bracket`), ctx)).status).toBe(401)

    // — Owner generates the bracket: 4 participants → 3 persisted matches (2 semis + final),
    //   and a second generate is refused 409.
    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    const gen = await GENERATE_BRACKET(req('POST', `${base}/bracket`), ctx)
    expect(gen.status).toBe(201)
    expect((await gen.json()).created).toBe(3)
    expect(await prisma.match.count({ where: { tournamentId: tournament.id } })).toBe(3)
    expect((await GENERATE_BRACKET(req('POST', `${base}/bracket`), ctx)).status).toBe(409)

    // — Judge assignment: owner assigns the judge to every round-1 match; intruder's attempt 403.
    const r1Matches = await prisma.match.findMany({ where: { tournamentId: tournament.id, round: 1 }, orderBy: { bracketOrder: 'asc' } })
    expect(r1Matches).toHaveLength(2)
    for (const m of r1Matches) {
      const assign = await ASSIGN_JUDGE(
        req('PATCH', `${base}/matches/${m.id}/judge`, { judgeId: judge.id }),
        { params: Promise.resolve({ id: tournament.id, matchId: m.id }) }
      )
      expect(assign.status).toBe(200)
    }
    const assigned = await prisma.match.findMany({ where: { tournamentId: tournament.id, judgeId: judge.id } })
    expect(assigned).toHaveLength(2)
    expect(assigned.every((m) => m.judgeId === judge.id)).toBe(true)

    // Assigning a non-JUDGE user is rejected 400.
    const badAssign = await ASSIGN_JUDGE(
      req('PATCH', `${base}/matches/${r1Matches[0].id}/judge`, { judgeId: players[0].id }),
      { params: Promise.resolve({ id: tournament.id, matchId: r1Matches[0].id }) }
    )
    expect(badAssign.status).toBe(400)

    mockAuth.mockResolvedValue(asSession({ id: intruder.id, name: intruder.username }))
    expect(
      (await ASSIGN_JUDGE(
        req('PATCH', `${base}/matches/${r1Matches[0].id}/judge`, { judgeId: intruder.id }),
        { params: Promise.resolve({ id: tournament.id, matchId: r1Matches[0].id }) }
      )).status
    ).toBe(403)
    // The failed attempt must not have changed the assignment.
    const untouched = await prisma.match.findUnique({ where: { id: r1Matches[0].id } })
    expect(untouched!.judgeId).toBe(judge.id)

    // — No-show: player4 (in semifinal 2) is withdrawn; the opponent is auto-advanced into
    //   the final's slot and the semifinal is COMPLETED with the opponent as winner.
    mockAuth.mockResolvedValue(asSession({ id: admin.id, name: admin.username })) // ADMIN may also act
    const noShow = await NOSHOW(req('POST', `${base}/noshow`, { userId: players[3].id }), ctx)
    expect(noShow.status).toBe(200)
    const withdrawn = await prisma.tournamentParticipant.findUnique({
      where: { tournamentId_userId: { tournamentId: tournament.id, userId: players[3].id } },
    })
    expect(withdrawn!.withdrawn).toBe(true)

    const semi2 = r1Matches[1]
    const afterNoShow = await prisma.match.findUnique({ where: { id: semi2.id } })
    expect(afterNoShow).toMatchObject({ status: 'COMPLETED', winnerId: players[2].id })
    const final = await prisma.match.findFirst({ where: { tournamentId: tournament.id, round: 2 } })
    expect(final).toMatchObject({ player2Id: players[2].id })

    // — Complete the tournament.
    const done = await COMPLETE(req('POST', `${base}/complete`), ctx)
    expect(done.status).toBe(200)
    const completed = await prisma.tournament.findUnique({ where: { id: tournament.id } })
    expect(completed!.completedAt).not.toBeNull()

    await prisma.match.deleteMany({ where: { tournamentId: tournament.id } })
    await prisma.tournamentParticipant.deleteMany({ where: { tournamentId: tournament.id } })
    await prisma.tournament.delete({ where: { id: tournament.id } })
    await prisma.ruleset.delete({ where: { id: ruleset.id } })
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, admin.id, judge.id, intruder.id, ...players.map((p) => p.id)] } } })
  })
})
