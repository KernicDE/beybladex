// tests/unit/team-stage.test.ts (RC15, issue #12)
// Direct unit coverage for lib/teamStage.ts — team-mode stage generation (error contract +
// encounter creation) and the best-of-3 encounter resolution hook the score route calls.
// Seam-Mocks on '@/lib/db' and '@/lib/notify' (same pattern as tests/unit/stage-generate.test.ts);
// lib/teams.ts's encounterState and the elimination pure libs are the real ones.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const tsFindUnique = vi.fn()
const tsUpdate = vi.fn()
const tmFindUnique = vi.fn()
const tmFindFirst = vi.fn()
const tmFindMany = vi.fn()
const tmUpdate = vi.fn()
const tmUpdateMany = vi.fn()
const tmCreateMany = vi.fn()
const tmCount = vi.fn()
const entryFindMany = vi.fn()
const matchCount = vi.fn()
const matchCreateMany = vi.fn()
const matchFindMany = vi.fn()
const userFindUnique = vi.fn()
const notifyMatchReady = vi.fn()

vi.mock('@/lib/db', () => ({
  prisma: {
    tournamentStage: {
      findUnique: (...a: unknown[]) => tsFindUnique(...a),
      update: (...a: unknown[]) => tsUpdate(...a),
    },
    teamMatch: {
      findUnique: (...a: unknown[]) => tmFindUnique(...a),
      findFirst: (...a: unknown[]) => tmFindFirst(...a),
      findMany: (...a: unknown[]) => tmFindMany(...a),
      update: (...a: unknown[]) => tmUpdate(...a),
      updateMany: (...a: unknown[]) => tmUpdateMany(...a),
      createMany: (...a: unknown[]) => tmCreateMany(...a),
      count: (...a: unknown[]) => tmCount(...a),
    },
    teamTournamentEntry: { findMany: (...a: unknown[]) => entryFindMany(...a) },
    match: {
      count: (...a: unknown[]) => matchCount(...a),
      createMany: (...a: unknown[]) => matchCreateMany(...a),
      findMany: (...a: unknown[]) => matchFindMany(...a),
    },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
  },
}))
vi.mock('@/lib/notify', () => ({ notifyMatchReady: (...a: unknown[]) => notifyMatchReady(...a) }))

import { generateTeamStage, resolveTeamEncounter } from '@/lib/teamStage'

const USER = 'user-1'
const T = 'tour-1'
const STAGE = 'stage-1'

function stageRow(overrides: Record<string, unknown> = {}) {
  return {
    id: STAGE,
    tournamentId: T,
    order: 1,
    format: 'SINGLE_ELIMINATION',
    status: 'PENDING',
    teamMatches: [],
    tournament: { createdById: USER },
    ...overrides,
  }
}

// A TeamMatch row as resolveTeamEncounter reads it (includes resolved by the mock).
function teamMatchRow(overrides: Record<string, unknown> = {}) {
  const slots = (prefix: string) => [1, 2, 3].map((position) => ({ position, userId: `${prefix}-${position}` }))
  return {
    id: 'tm-1',
    stageId: STAGE,
    round: 1,
    bracketOrder: 0,
    bracketSide: null,
    status: 'IN_PROGRESS',
    team1EntryId: 'entry-1',
    team2EntryId: 'entry-2',
    winnerEntryId: null,
    winsTeam1: 0,
    winsTeam2: 0,
    team1Entry: { slots: slots('a') },
    team2Entry: { slots: slots('b') },
    games: [
      { id: 'g1', status: 'COMPLETED', winnerId: 'a-1' },
      { id: 'g2', status: 'PENDING', winnerId: null },
      { id: 'g3', status: 'PENDING', winnerId: null },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('generateTeamStage error contract (route maps these 1:1)', () => {
  const args = { userId: USER, tournamentId: T, stageId: STAGE }

  it('missing stage (or wrong tournament) → 404 not_found', async () => {
    tsFindUnique.mockResolvedValue(null)
    await expect(generateTeamStage(args)).rejects.toMatchObject({ status: 404, payload: { error: 'not_found' } })

    tsFindUnique.mockResolvedValue(stageRow({ tournamentId: 'other-tour' }))
    await expect(generateTeamStage(args)).rejects.toMatchObject({ status: 404 })
  })

  it('non-owner without ADMIN role → 403 forbidden', async () => {
    tsFindUnique.mockResolvedValue(stageRow({ tournament: { createdById: 'someone-else' } }))
    userFindUnique.mockResolvedValue({ role: 'USER' })
    await expect(generateTeamStage(args)).rejects.toMatchObject({ status: 403, payload: { error: 'forbidden' } })
  })

  it('COMPLETED stage → 409 stage_completed', async () => {
    tsFindUnique.mockResolvedValue(stageRow({ status: 'COMPLETED' }))
    await expect(generateTeamStage(args)).rejects.toMatchObject({ status: 409, payload: { error: 'stage_completed' } })
  })

  it('standings-ranked formats → 409 team_format_unsupported (v1: elimination only)', async () => {
    tsFindUnique.mockResolvedValue(stageRow({ format: 'SWISS' }))
    await expect(generateTeamStage(args)).rejects.toMatchObject({ status: 409, payload: { error: 'team_format_unsupported' } })

    tsFindUnique.mockResolvedValue(stageRow({ format: 'ROUND_ROBIN' }))
    await expect(generateTeamStage(args)).rejects.toMatchObject({ status: 409, payload: { error: 'team_format_unsupported' } })
  })

  it('existing encounters → 409 bracket_exists', async () => {
    tsFindUnique.mockResolvedValue(stageRow({ teamMatches: [{ id: 'tm-existing' }] }))
    await expect(generateTeamStage(args)).rejects.toMatchObject({ status: 409, payload: { error: 'bracket_exists' } })
  })

  it('fewer than 2 checked-in entries → 422 not_enough_participants (single elimination)', async () => {
    tsFindUnique.mockResolvedValue(stageRow())
    entryFindMany.mockResolvedValue([{ id: 'entry-1', seed: null }])
    await expect(generateTeamStage(args)).rejects.toMatchObject({ status: 422, payload: { error: 'not_enough_participants', checkedIn: 1 } })
  })
})

describe('generateTeamStage happy path (4 entries, single elimination)', () => {
  const args = { userId: USER, tournamentId: T, stageId: STAGE }
  const entries = ['e1', 'e2', 'e3', 'e4'].map((id) => ({ id, seed: null }))

  it('creates 3 encounters (2 played + 1 final shell), 6 sub-games, activates the stage', async () => {
    tsFindUnique.mockResolvedValue(stageRow())
    entryFindMany.mockResolvedValue(entries)
    tmFindMany.mockResolvedValue([
      {
        id: 'tm-a', stageId: STAGE, bracketOrder: 0, status: 'PENDING',
        team1Entry: { slots: [1, 2, 3].map((p) => ({ position: p, userId: `e1-${p}` })) },
        team2Entry: { slots: [1, 2, 3].map((p) => ({ position: p, userId: `e2-${p}` })) },
      },
      {
        id: 'tm-b', stageId: STAGE, bracketOrder: 1, status: 'PENDING',
        team1Entry: { slots: [1, 2, 3].map((p) => ({ position: p, userId: `e3-${p}` })) },
        team2Entry: { slots: [1, 2, 3].map((p) => ({ position: p, userId: `e4-${p}` })) },
      },
    ])
    matchCount.mockResolvedValue(0)
    matchFindMany.mockResolvedValue([{ id: 'g1' }, { id: 'g2' }, { id: 'g3' }, { id: 'g4' }, { id: 'g5' }, { id: 'g6' }])

    const result = await generateTeamStage(args)

    expect(result.status).toBe(201)
    // 4 entries → nextPow2 4 → 2 round-1 encounters + 1 final shell.
    expect(tmCreateMany).toHaveBeenCalledTimes(1)
    expect(tmCreateMany.mock.calls[0][0].data).toHaveLength(3)
    // Both round-1 encounters have both teams → 2 × 3 sub-games; the empty final shell gets none.
    expect(matchCreateMany).toHaveBeenCalledTimes(2)
    expect(matchCreateMany.mock.calls[0][0].data).toHaveLength(3)
    expect(matchCreateMany.mock.calls[0][0].data[0]).toMatchObject({
      player1Id: 'e1-1', player2Id: 'e2-1', round: 0, teamMatchId: 'tm-a', status: 'PENDING',
    })
    expect(tsUpdate).toHaveBeenCalledWith({ where: { id: STAGE }, data: { status: 'ACTIVE' } })
    // No bye with 4 entries: 0 or 1 bye? exactly 0 — writeTeamSlot's updateMany count 0 path.
    expect(tmUpdateMany).not.toHaveBeenCalled()
    expect(notifyMatchReady).toHaveBeenCalledTimes(6)
  })
})

describe('resolveTeamEncounter — the score-route hook', () => {
  it('open encounter → only the running win counts are persisted, no bracket propagation', async () => {
    tmFindUnique.mockResolvedValue(teamMatchRow()) // game 1 won by team 1, games 2-3 open
    await resolveTeamEncounter('tm-1')
    expect(tmUpdateMany).toHaveBeenCalledWith({
      where: { id: 'tm-1', status: { not: 'COMPLETED' } },
      data: { winsTeam1: 1, winsTeam2: 0 },
    })
    expect(tsFindUnique).not.toHaveBeenCalled() // no propagation while open
  })

  it('2-0 → encounter COMPLETED for team 1, winner advances into the SE next slot', async () => {
    tmFindUnique.mockResolvedValue(teamMatchRow({
      games: [
        { id: 'g1', status: 'COMPLETED', winnerId: 'a-2' },
        { id: 'g2', status: 'COMPLETED', winnerId: 'a-1' },
        { id: 'g3', status: 'PENDING', winnerId: null },
      ],
    }))
    tsFindUnique.mockResolvedValue({ format: 'SINGLE_ELIMINATION' })
    tmUpdateMany.mockResolvedValue({ count: 1 })
    // The slot write finds no completed follow-up encounter (count 0) — enough to prove propagation ran.
    await resolveTeamEncounter('tm-1')
    expect(tmUpdateMany).toHaveBeenCalledWith({
      where: { id: 'tm-1', status: { not: 'COMPLETED' } },
      data: { status: 'COMPLETED', winnerEntryId: 'entry-1', winsTeam1: 2, winsTeam2: 0 },
    })
    // nextSingleEliminationSlot({round:1, bracketOrder:0}) → round 2, order 0, team1 slot.
    expect(tmUpdateMany).toHaveBeenCalledWith({
      where: { stageId: STAGE, round: 2, bracketOrder: 0 },
      data: { team1EntryId: 'entry-1' },
    })
  })

  it('2-1 after three games → team 2 takes the encounter', async () => {
    tmFindUnique.mockResolvedValue(teamMatchRow({
      games: [
        { id: 'g1', status: 'COMPLETED', winnerId: 'a-1' },
        { id: 'g2', status: 'COMPLETED', winnerId: 'b-2' },
        { id: 'g3', status: 'COMPLETED', winnerId: 'b-3' },
      ],
    }))
    tsFindUnique.mockResolvedValue({ format: 'SINGLE_ELIMINATION' })
    tmUpdateMany.mockResolvedValue({ count: 1 })
    await resolveTeamEncounter('tm-1')
    expect(tmUpdateMany).toHaveBeenCalledWith({
      where: { id: 'tm-1', status: { not: 'COMPLETED' } },
      data: { status: 'COMPLETED', winnerEntryId: 'entry-2', winsTeam1: 1, winsTeam2: 2 },
    })
  })

  it('already-resolved encounter (lost race) → claim count 0, no double propagation', async () => {
    tmFindUnique.mockResolvedValue(teamMatchRow({
      status: 'COMPLETED',
      games: [
        { id: 'g1', status: 'COMPLETED', winnerId: 'a-1' },
        { id: 'g2', status: 'COMPLETED', winnerId: 'a-2' },
        { id: 'g3', status: 'PENDING', winnerId: null },
      ],
    }))
    tsFindUnique.mockResolvedValue({ format: 'SINGLE_ELIMINATION' })
    tmUpdateMany.mockResolvedValue({ count: 0 }) // someone else claimed it between read and write
    await resolveTeamEncounter('tm-1')
    // The claim was attempted exactly once and lost the race → no bracket propagation follows.
    expect(tmUpdateMany).toHaveBeenCalledTimes(1)
    expect(tmUpdateMany).toHaveBeenCalledWith({
      where: { id: 'tm-1', status: { not: 'COMPLETED' } },
      data: { status: 'COMPLETED', winnerEntryId: 'entry-1', winsTeam1: 2, winsTeam2: 0 },
    })
    expect(tsFindUnique).not.toHaveBeenCalled()
  })
})
