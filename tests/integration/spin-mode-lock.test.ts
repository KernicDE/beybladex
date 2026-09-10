// tests/integration/spin-mode-lock.test.ts (Phase 16 items 1-2)
// Integration — CI-only (Postgres/Redis). Setting a dual-spin build's spin mode at match start
// (status PENDING → IN_PROGRESS) succeeds; a second request attempting to change it once the
// match has left PENDING is rejected with 409. Resubmitting the SAME value once IN_PROGRESS is
// a harmless no-op, not a conflict.
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

afterEach(() => mockAuth.mockReset())

describe('dual-spin mode lock', () => {
  it('locks at match start and rejects a later attempt to change it (409), but tolerates resubmitting the same value', async () => {
    const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const organizer = await prisma.user.create({ data: { username: `sml_org_${suffix}`, passwordHash: 'x', role: 'ORGANIZER' } })
    const judge = await prisma.user.create({ data: { username: `sml_jdg_${suffix}`, passwordHash: 'x', role: 'JUDGE' } })
    const p1 = await prisma.user.create({ data: { username: `sml_p1_${suffix}`, passwordHash: 'x' } })
    const p2 = await prisma.user.create({ data: { username: `sml_p2_${suffix}`, passwordHash: 'x' } })

    const dualBlade = await prisma.part.create({
      data: { name: `DualBlade ${suffix}`, manufacturer: 'TT', category: 'BLADE', spinDirection: 'RIGHT', dualSpin: true },
    })
    const ratchet = await prisma.part.create({ data: { name: `R ${suffix}`, manufacturer: 'TT', category: 'RATCHET', spinDirection: 'RIGHT' } })
    const bit = await prisma.part.create({ data: { name: `Bit ${suffix}`, manufacturer: 'TT', category: 'BIT', spinDirection: 'RIGHT' } })
    const build1 = await prisma.build.create({ data: { name: `Build1 ${suffix}`, type: 'ATTACK', bladeId: dualBlade.id, ratchetId: ratchet.id, bitId: bit.id } })

    const ruleset = await prisma.ruleset.create({
      data: { title: `SML ${suffix}`, slug: `sml-${suffix}`, createdById: organizer.id, targetPoints: 3, finalsTargetPoints: 5 },
    })
    const tournament = await prisma.tournament.create({
      data: {
        title: `SML T ${suffix}`, description: '', startDate: new Date(Date.now() + 86400_000), locationName: 'Arena',
        postalCode: '10115', city: 'Berlin', state: 'Berlin', latitude: 52.52, longitude: 13.405,
        rulesetId: ruleset.id, createdById: organizer.id,
      },
    })
    const stage = await prisma.tournamentStage.create({
      data: { tournamentId: tournament.id, order: 1, name: 'Bracket', format: 'SINGLE_ELIMINATION' },
    })
    const match = await prisma.match.create({
      data: { tournamentId: tournament.id, stageId: stage.id, judgeId: judge.id, player1Id: p1.id, player2Id: p2.id, round: 1, bracketOrder: 0, status: 'PENDING' },
    })
    const finalPlaceholder = await prisma.match.create({
      data: { tournamentId: tournament.id, stageId: stage.id, round: 2, bracketOrder: 0, status: 'PENDING' },
    })
    void finalPlaceholder

    const ctx = { params: Promise.resolve({ id: match.id }) }
    mockAuth.mockResolvedValue(asSession({ id: judge.id, name: judge.username }))

    // Match start: confirm build1 with RIGHT mode — status PENDING → IN_PROGRESS.
    const start = await SCORE(
      req({ clientEventId: `evt-${suffix}-start`, scorePlayer1: 0, scorePlayer2: 0, status: 'IN_PROGRESS', player1BuildId: build1.id, player1SpinMode: 'RIGHT' }),
      ctx
    )
    expect(start.status).toBe(200)
    let row = await prisma.match.findUnique({ where: { id: match.id } })
    expect(row?.player1SpinMode).toBe('RIGHT')

    // Attempting to change it to LEFT once the match has left PENDING → 409.
    const changeAttempt = await SCORE(
      req({ clientEventId: `evt-${suffix}-change`, scorePlayer1: 0, scorePlayer2: 0, status: 'IN_PROGRESS', player1SpinMode: 'LEFT' }),
      ctx
    )
    expect(changeAttempt.status).toBe(409)
    row = await prisma.match.findUnique({ where: { id: match.id } })
    expect(row?.player1SpinMode).toBe('RIGHT') // unchanged

    // Resubmitting the SAME value (RIGHT) is a harmless no-op, not a conflict.
    const resubmitSame = await SCORE(
      req({ clientEventId: `evt-${suffix}-same`, event: { type: 'SPIN', player: 1 }, scorePlayer1: 1, scorePlayer2: 0, player1SpinMode: 'RIGHT' }),
      ctx
    )
    expect(resubmitSame.status).toBe(200)
  })

  // [REVIEW-FIX P16-1 regression] a null→value transition (no spin mode stored yet) must be
  // rejected once the match has left PENDING — not just a value→different-value change. Uses
  // a fresh match/build pair (player2's side) so no spin mode is ever set at match start.
  it('rejects setting a spin mode for the first time after the match has left PENDING (null→value)', async () => {
    const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const organizer = await prisma.user.create({ data: { username: `smlb_org_${suffix}`, passwordHash: 'x', role: 'ORGANIZER' } })
    const judge = await prisma.user.create({ data: { username: `smlb_jdg_${suffix}`, passwordHash: 'x', role: 'JUDGE' } })
    const p1 = await prisma.user.create({ data: { username: `smlb_p1_${suffix}`, passwordHash: 'x' } })
    const p2 = await prisma.user.create({ data: { username: `smlb_p2_${suffix}`, passwordHash: 'x' } })

    const dualBlade = await prisma.part.create({
      data: { name: `DualBlade2 ${suffix}`, manufacturer: 'TT', category: 'BLADE', spinDirection: 'RIGHT', dualSpin: true },
    })
    const ratchet = await prisma.part.create({ data: { name: `R2 ${suffix}`, manufacturer: 'TT', category: 'RATCHET', spinDirection: 'RIGHT' } })
    const bit = await prisma.part.create({ data: { name: `Bit2 ${suffix}`, manufacturer: 'TT', category: 'BIT', spinDirection: 'RIGHT' } })
    const nonDualBlade = await prisma.part.create({ data: { name: `PlainBlade ${suffix}`, manufacturer: 'TT', category: 'BLADE', spinDirection: 'RIGHT' } })
    const dualBuild = await prisma.build.create({ data: { name: `DualBuild ${suffix}`, type: 'ATTACK', bladeId: dualBlade.id, ratchetId: ratchet.id, bitId: bit.id } })
    const plainBuild = await prisma.build.create({ data: { name: `PlainBuild ${suffix}`, type: 'ATTACK', bladeId: nonDualBlade.id, ratchetId: ratchet.id, bitId: bit.id } })

    const ruleset = await prisma.ruleset.create({
      data: { title: `SMLB ${suffix}`, slug: `smlb-${suffix}`, createdById: organizer.id, targetPoints: 3, finalsTargetPoints: 5 },
    })
    const tournament = await prisma.tournament.create({
      data: {
        title: `SMLB T ${suffix}`, description: '', startDate: new Date(Date.now() + 86400_000), locationName: 'Arena',
        postalCode: '10115', city: 'Berlin', state: 'Berlin', latitude: 52.52, longitude: 13.405,
        rulesetId: ruleset.id, createdById: organizer.id,
      },
    })
    const stage = await prisma.tournamentStage.create({
      data: { tournamentId: tournament.id, order: 1, name: 'Bracket', format: 'SINGLE_ELIMINATION' },
    })
    const match = await prisma.match.create({
      data: { tournamentId: tournament.id, stageId: stage.id, judgeId: judge.id, player1Id: p1.id, player2Id: p2.id, round: 1, bracketOrder: 0, status: 'PENDING' },
    })
    await prisma.match.create({ data: { tournamentId: tournament.id, stageId: stage.id, round: 2, bracketOrder: 0, status: 'PENDING' } })

    const ctx = { params: Promise.resolve({ id: match.id }) }
    mockAuth.mockResolvedValue(asSession({ id: judge.id, name: judge.username }))

    // Match start WITHOUT confirming a spin mode at all (a judge who missed the dual-spin part,
    // or a non-dual-spin build case elsewhere) — status leaves PENDING with player1SpinMode null.
    const start = await SCORE(
      req({ clientEventId: `evt-${suffix}-start`, scorePlayer1: 0, scorePlayer2: 0, status: 'IN_PROGRESS', player1BuildId: dualBuild.id }),
      ctx
    )
    expect(start.status).toBe(200)
    const afterStart = await prisma.match.findUnique({ where: { id: match.id } })
    expect(afterStart?.player1SpinMode).toBeNull()

    // Now attempting to SET it (null → 'RIGHT') after the match has left PENDING → 409, not
    // silently accepted (this was the exact bug: only value→different-value was caught before).
    const lateSet = await SCORE(
      req({ clientEventId: `evt-${suffix}-lateset`, scorePlayer1: 0, scorePlayer2: 0, status: 'IN_PROGRESS', player1SpinMode: 'RIGHT' }),
      ctx
    )
    expect(lateSet.status).toBe(409)
    const stillNull = await prisma.match.findUnique({ where: { id: match.id } })
    expect(stillNull?.player1SpinMode).toBeNull()

    // Separately: a spin mode may never be recorded for a build with NO dual-spin part, even
    // while still PENDING — rejected with 400, never silently stored.
    const match2 = await prisma.match.create({
      data: { tournamentId: tournament.id, stageId: stage.id, judgeId: judge.id, player1Id: p1.id, player2Id: p2.id, round: 3, bracketOrder: 0, status: 'PENDING' },
    })
    const notDualSpin = await SCORE(
      req({
        clientEventId: `evt-${suffix}-notdual`, scorePlayer1: 0, scorePlayer2: 0, status: 'IN_PROGRESS',
        player1BuildId: plainBuild.id, player1SpinMode: 'RIGHT',
      }),
      { params: Promise.resolve({ id: match2.id }) }
    )
    expect(notDualSpin.status).toBe(400)
    expect((await notDualSpin.json()).error).toBe('not_dual_spin_build')
  })
})
