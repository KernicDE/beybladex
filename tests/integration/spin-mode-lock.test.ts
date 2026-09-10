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
})
