// tests/unit/stage-generate.test.ts (RC4, issue #57)
// Direct unit coverage for lib/stageGenerate.ts — the extracted stage-generation core. The
// error contract (exact statuses + payload tokens the route maps 1:1) and one ROUND_ROBIN
// happy path are exercised without HTTP/DB via Seam-Mocks on '@/lib/db', '@/lib/notify' and
// '@/lib/arenaAssign'. The pure pairing libraries (lib/roundRobin etc.) are the real ones.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const findUnique = vi.fn()
const findMany = vi.fn()
const count = vi.fn()
const createMany = vi.fn()
const update = vi.fn()
const userFindUnique = vi.fn()
const tournamentUpdate = vi.fn()
const notifyMatchReady = vi.fn()
const assignArenasAtGeneration = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    tournamentStage: { findUnique: (...a: unknown[]) => findUnique(...a), update: (...a: unknown[]) => update(...a) },
    match: { count: (...a: unknown[]) => count(...a), createMany: (...a: unknown[]) => createMany(...a), findMany: (...a: unknown[]) => findMany(...a) },
    tournamentParticipant: { findMany: (...a: unknown[]) => findMany(...a) },
    stageStanding: { count: (...a: unknown[]) => count(...a), createMany: (...a: unknown[]) => createMany(...a), findMany: (...a: unknown[]) => findMany(...a), updateMany: vi.fn() },
    tournament: { update: (...a: unknown[]) => tournamentUpdate(...a) },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
  },
}))
vi.mock('@/lib/notify', () => ({ notifyMatchReady: (...a: unknown[]) => notifyMatchReady(...a) }))
vi.mock('@/lib/arenaAssign', () => ({ assignArenasAtGeneration: (...a: unknown[]) => assignArenasAtGeneration(...a) }))

import { generateStage, StageGenerateError } from '@/lib/stageGenerate'

const USER = 'user-1'
const T = 'tour-1'
const STAGE = 'stage-1'

function stageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: STAGE,
    tournamentId: T,
    order: 1,
    format: 'ROUND_ROBIN',
    status: 'ACTIVE',
    roundRobinRepeats: 1,
    swissRounds: null,
    swissRoundsDone: 0,
    matches: [],
    tournament: { createdById: USER, arenaCount: null },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('generateStage error contract (route maps these 1:1)', () => {
  it('missing stage (or wrong tournament) → 404 not_found', async () => {
    findUnique.mockResolvedValue(null)
    await expect(generateStage({ userId: USER, tournamentId: T, stageId: STAGE, arenaCount: null }))
      .rejects.toMatchObject({ status: 404, payload: { error: 'not_found' } })

    findUnique.mockResolvedValue(stageRow({ tournamentId: 'other-tour' }))
    await expect(generateStage({ userId: USER, tournamentId: T, stageId: STAGE, arenaCount: null }))
      .rejects.toMatchObject({ status: 404 })
  })

  it('non-owner without ADMIN role → 403 forbidden (owner check needs no role read)', async () => {
    findUnique.mockResolvedValue(stageRow({ tournament: { createdById: 'someone-else', arenaCount: null } }))
    userFindUnique.mockResolvedValue({ role: 'USER' })
    await expect(generateStage({ userId: USER, tournamentId: T, stageId: STAGE, arenaCount: null }))
      .rejects.toMatchObject({ status: 403, payload: { error: 'forbidden' } })
  })

  it('ADMIN who is not the owner may generate (the role read decides)', async () => {
    findUnique.mockResolvedValue(stageRow({ tournament: { createdById: 'someone-else', arenaCount: null } }))
    userFindUnique.mockResolvedValue({ role: 'ADMIN' })
    count.mockResolvedValue(1) // existing matches → bracket_exists is fine as proof of passing the gate
    await expect(generateStage({ userId: USER, tournamentId: T, stageId: STAGE, arenaCount: null }))
      .rejects.toMatchObject({ status: 409, payload: { error: 'bracket_exists' } })
  })

  it('COMPLETED stage → 409 stage_completed before any pool work', async () => {
    findUnique.mockResolvedValue(stageRow({ status: 'COMPLETED' }))
    await expect(generateStage({ userId: USER, tournamentId: T, stageId: STAGE, arenaCount: null }))
      .rejects.toMatchObject({ status: 409, payload: { error: 'stage_completed' } })
    expect(count).not.toHaveBeenCalled()
  })

  it('existing matches on a non-SWISS stage → 409 bracket_exists', async () => {
    findUnique.mockResolvedValue(stageRow())
    count.mockResolvedValue(3)
    await expect(generateStage({ userId: USER, tournamentId: T, stageId: STAGE, arenaCount: null }))
      .rejects.toMatchObject({ status: 409, payload: { error: 'bracket_exists' } })
  })

  it('pool below the format minimum → 422 not_enough_participants', async () => {
    findUnique.mockResolvedValue(stageRow())
    count.mockResolvedValue(0)
    // first stage: checked-in participants; only ONE is present
    findMany.mockResolvedValueOnce([{ userId: 'p1', seed: null }])
    await expect(generateStage({ userId: USER, tournamentId: T, stageId: STAGE, arenaCount: null }))
      .rejects.toMatchObject({ status: 422, payload: { error: 'not_enough_participants', checkedIn: 1 } })
  })
})

describe('generateStage ROUND_ROBIN happy path (one-shot fixture list)', () => {
  it('persists the circle-method schedule, seeds standings, activates the stage', async () => {
    findUnique.mockResolvedValue(stageRow())
    count.mockResolvedValue(0)
    // call order: participant pool read, then readyMatches read (round 1)
    findMany
      .mockResolvedValueOnce([
        { userId: 'p1', seed: 1 },
        { userId: 'p2', seed: 2 },
        { userId: 'p3', seed: null },
      ])
      .mockResolvedValueOnce([{ id: 'm1' }, { id: 'm2' }])

    const result = await generateStage({ userId: USER, tournamentId: T, stageId: STAGE, arenaCount: null })

    // 3 players → 3 rounds × (3/2 → 1 pairing + 1 bye) = 3 matches total
    expect(result.status).toBe(201)
    expect(result.payload.created).toBe(3)
    expect(createMany).toHaveBeenCalledTimes(2) // matches + standings
    const matchRows = createMany.mock.calls[0][0].data as { round: number; player1Id: string; player2Id: string | null; status: string }[]
    expect(matchRows).toHaveLength(3)
    expect(matchRows.every((r) => r.status === 'PENDING' && r.player1Id !== r.player2Id)).toBe(true)
    const standingRows = createMany.mock.calls[1][0].data as { userId: string }[]
    expect(standingRows.map((r) => r.userId).sort()).toEqual(['p1', 'p2', 'p3'])
    expect(update).toHaveBeenCalledWith({ where: { id: STAGE }, data: { status: 'ACTIVE' } })
    // round-1-only notification scope (P18-5): exactly the round-1 matches, never future rounds
    expect(notifyMatchReady.mock.calls.map((c) => c[0]).sort()).toEqual(['m1', 'm2'])
  })

  it('a valid arenaCount override persists on the tournament before generation', async () => {
    findUnique.mockResolvedValue(stageRow())
    count.mockResolvedValue(0)
    findMany
      .mockResolvedValueOnce([{ userId: 'p1', seed: null }, { userId: 'p2', seed: null }])
      .mockResolvedValueOnce([{ id: 'm1' }])
    await generateStage({ userId: USER, tournamentId: T, stageId: STAGE, arenaCount: 4 })
    expect(tournamentUpdate).toHaveBeenCalledWith({ where: { id: T }, data: { arenaCount: 4 } })
    expect(assignArenasAtGeneration).toHaveBeenCalledWith(STAGE, 4)
  })

  it('StageGenerateError carries the payload for the route to map', () => {
    const e = new StageGenerateError(409, { error: 'round_incomplete' })
    expect(e.status).toBe(409)
    expect(e.payload).toEqual({ error: 'round_incomplete' })
    expect(e.message).toBe('round_incomplete')
  })
})
