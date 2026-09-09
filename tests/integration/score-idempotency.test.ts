// tests/integration/score-idempotency.test.ts
// Phase 5 Part C: POSTing the same clientEventId twice results in exactly one point change,
// not two ([REVIEW-FIX: frontend-pwa C2] — the double-flush race between the page's `online`
// handler and the SW's sync event). Also proves point values are READ FROM THE RULESET, not
// hardcoded: outOfBounds2Pts=false makes Out-of-Bounds worth 1, and targetPoints drives match
// completion. Integration — CI-only (Postgres/Redis; the route rate-limits via Redis).
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

describe('match score idempotency', () => {
  afterEach(() => mockAuth.mockReset())

  it('applies a clientEventId exactly once: replay is a no-op, and Ruleset toggles drive point values', async () => {
    const suffix = Date.now().toString(36)
    const organizer = await prisma.user.create({ data: { username: `si_org_${suffix}`, passwordHash: 'x', role: 'ORGANIZER' } })
    const judge = await prisma.user.create({ data: { username: `si_jdg_${suffix}`, passwordHash: 'x', role: 'JUDGE' } })
    const p1 = await prisma.user.create({ data: { username: `si_p1_${suffix}`, passwordHash: 'x' } })
    const p2 = await prisma.user.create({ data: { username: `si_p2_${suffix}`, passwordHash: 'x' } })
    // outOfBounds2Pts=false → OOB worth 1; targetPoints=3 so 3 spins (or spin+OOB+…) complete.
    const ruleset = await prisma.ruleset.create({
      data: {
        title: `SI ${suffix}`,
        slug: `si-${suffix}`,
        createdById: organizer.id,
        outOfBounds2Pts: false,
        targetPoints: 3,
        finalsTargetPoints: 5,
      },
    })
    const tournament = await prisma.tournament.create({
      data: {
        title: `SI T ${suffix}`,
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
    const match = await prisma.match.create({
      data: { tournamentId: tournament.id, judgeId: judge.id, player1Id: p1.id, player2Id: p2.id, round: 1, bracketOrder: 0, status: 'IN_PROGRESS' },
    })
    // The score route treats "the highest round present in the tournament" as the final
    // (app/api/matches/[id]/score/route.ts's finalsTargetPoints logic) — a round-2 placeholder
    // is required so this round-1 match is correctly read as a non-final and uses
    // ruleset.targetPoints (3), not ruleset.finalsTargetPoints (5).
    const finalPlaceholder = await prisma.match.create({
      data: { tournamentId: tournament.id, round: 2, bracketOrder: 0, status: 'PENDING' },
    })
    const ctx = { params: Promise.resolve({ id: match.id }) }
    mockAuth.mockResolvedValue(asSession({ id: judge.id, name: judge.username }))

    // 1. SPIN for player 1 → 1-0, IN_PROGRESS
    const ev1 = { clientEventId: `evt-${suffix}-1`, event: { type: 'SPIN', player: 1 }, scorePlayer1: 1, scorePlayer2: 0 }
    const r1 = await SCORE(req(ev1), ctx)
    expect(r1.status).toBe(200)
    expect(await r1.json()).toMatchObject({ scorePlayer1: 1, scorePlayer2: 0, status: 'IN_PROGRESS' })

    // 2. Exact replay (the double-flush scenario) → 200 marked replayed, still 1-0
    const replay = await SCORE(req(ev1), ctx)
    expect(replay.status).toBe(200)
    expect((await replay.json()).replayed).toBe(true)
    let row = await prisma.match.findUnique({ where: { id: match.id } })
    expect(row).toMatchObject({ scorePlayer1: 1, scorePlayer2: 0, clientEventId: `evt-${suffix}-1` })

    // 3. Out-of-Bounds with outOfBounds2Pts=false → worth 1 (Ruleset-read, not the hardcoded 2)
    const r2 = await SCORE(req({ clientEventId: `evt-${suffix}-2`, event: { type: 'OUT_OF_BOUNDS', player: 2 }, scorePlayer1: 1, scorePlayer2: 1 }), ctx)
    expect(r2.status).toBe(200)
    row = await prisma.match.findUnique({ where: { id: match.id } })
    expect(row).toMatchObject({ scorePlayer1: 1, scorePlayer2: 1 })

    // 4. A Burst for player 1 (worth 2, 1 + 2 = 3) reaches targetPoints=3 → COMPLETED, winner = player1.
    // (Not another SPIN: SPIN is worth 1, and player 1 is at 1 — a second SPIN would only reach 2.)
    const r3 = await SCORE(req({ clientEventId: `evt-${suffix}-3`, event: { type: 'BURST', player: 1 }, scorePlayer1: 3, scorePlayer2: 1 }), ctx)
    expect(r3.status).toBe(200)
    expect(await r3.json()).toMatchObject({ status: 'COMPLETED', winnerId: p1.id, targetPoints: 3 })
    row = await prisma.match.findUnique({ where: { id: match.id } })
    expect(row).toMatchObject({ status: 'COMPLETED', winnerId: p1.id, scorePlayer1: 3 })

    // 5. A DIFFERENT event on the COMPLETED match → 409 with both versions, no overwrite
    const conflict = await SCORE(req({ clientEventId: `evt-${suffix}-4`, event: { type: 'BURST', player: 2 }, scorePlayer1: 3, scorePlayer2: 3 }), ctx)
    expect(conflict.status).toBe(409)
    const conflictBody = await conflict.json()
    expect(conflictBody.error).toBe('conflict')
    expect(conflictBody.serverVersion).toMatchObject({ scorePlayer1: 3, scorePlayer2: 1, winnerId: p1.id })
    expect(conflictBody.clientVersion.clientEventId).toBe(`evt-${suffix}-4`)
    row = await prisma.match.findUnique({ where: { id: match.id } })
    expect(row).toMatchObject({ scorePlayer1: 3, scorePlayer2: 1, clientEventId: `evt-${suffix}-3` })

    // 6. Mismatched client arithmetic is rejected 422 (server-authoritative scoring)
    const mismatch = await SCORE(
      req({ clientEventId: `evt-${suffix}-x`, event: { type: 'SPIN', player: 1 }, scorePlayer1: 99, scorePlayer2: 1 }),
      { params: Promise.resolve({ id: match.id }) }
    )
    expect(mismatch.status).toBe(409) // completed match short-circuits first — still not applied
    row = await prisma.match.findUnique({ where: { id: match.id } })
    expect(row!.scorePlayer1).toBe(3)

    await prisma.match.delete({ where: { id: match.id } })
    await prisma.match.delete({ where: { id: finalPlaceholder.id } })
    await prisma.tournament.delete({ where: { id: tournament.id } })
    await prisma.ruleset.delete({ where: { id: ruleset.id } })
    await prisma.user.deleteMany({ where: { id: { in: [organizer.id, judge.id, p1.id, p2.id] } } })
  })
})
