// tests/unit/arena-assign.test.ts
// Phase 7 — lib/arenaAssign.ts without a real DB (@/lib/db is mocked, same pattern as
// friendship-batch.test.ts). Covers: the pure queue pick (round → swissRound → bracketOrder,
// skipping matches missing a player), the generation-time cycling assignment per round group
// (extras stay unassigned and wait for the dynamic pass), and the freed-arena dynamic pass
// (no-op without an arena number, atomic claim, lost-race re-queue).
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    match: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}))

import { prisma } from '@/lib/db'
import {
  parseArenaCount,
  arenaForIndex,
  nextWaitingMatchId,
  assignArenasAtGeneration,
  assignFreedArena,
  type ArenaQueueMatch,
} from '@/lib/arenaAssign'

const findMany = vi.mocked(prisma.match.findMany)
const update = vi.mocked(prisma.match.update)
const updateMany = vi.mocked(prisma.match.updateMany)

function queueMatch(overrides: Partial<ArenaQueueMatch> = {}): ArenaQueueMatch {
  return {
    id: 'm1',
    round: 1,
    swissRound: null,
    bracketOrder: 0,
    status: 'PENDING',
    arenaNumber: null,
    player1Id: 'u1',
    player2Id: 'u2',
    ...overrides,
  }
}

describe('parseArenaCount', () => {
  it('accepts integers 1..64 and ignores everything else', () => {
    expect(parseArenaCount(1)).toBe(1)
    expect(parseArenaCount(64)).toBe(64)
    expect(parseArenaCount(0)).toBeNull()
    expect(parseArenaCount(65)).toBeNull()
    expect(parseArenaCount(2.5)).toBeNull()
    expect(parseArenaCount('4')).toBeNull()
    expect(parseArenaCount(null)).toBeNull()
    expect(parseArenaCount(undefined)).toBeNull()
  })
})

describe('arenaForIndex (generation cycling)', () => {
  it('assigns arenas 1..arenaCount in order, then null for the extras', () => {
    expect(arenaForIndex(0, 3)).toBe(1)
    expect(arenaForIndex(1, 3)).toBe(2)
    expect(arenaForIndex(2, 3)).toBe(3)
    expect(arenaForIndex(3, 3)).toBeNull() // beyond arenaCount — waits for the dynamic pass
    expect(arenaForIndex(4, 3)).toBeNull()
  })
})

describe('nextWaitingMatchId (pure queue pick)', () => {
  it('orders by lowest round, then lowest swissRound, then lowest bracketOrder', () => {
    const matches = [
      queueMatch({ id: 'late-bracket-order', round: 2, bracketOrder: 0 }),
      queueMatch({ id: 'higher-round', round: 3, bracketOrder: 0 }),
      queueMatch({ id: 'later-swiss', round: 2, swissRound: 5, bracketOrder: 0 }),
      queueMatch({ id: 'winner', round: 2, swissRound: 4, bracketOrder: 7 }),
      queueMatch({ id: 'earlier-bracket-order', round: 2, swissRound: 4, bracketOrder: 2 }),
    ]
    expect(nextWaitingMatchId(matches)).toBe('earlier-bracket-order')
    // swissRound nulls sort LAST (Postgres ASC semantics): the Swiss round-5 match precedes the
    // bracket match (swissRound null) at the same round.
    expect(nextWaitingMatchId([matches[0], matches[1], matches[2]])).toBe('later-swiss')
  })

  it('skips matches missing a player, already assigned, or not PENDING', () => {
    const matches = [
      queueMatch({ id: 'empty-slot', player2Id: null }),
      queueMatch({ id: 'assigned', arenaNumber: 2 }),
      queueMatch({ id: 'in-progress', status: 'IN_PROGRESS' }),
      queueMatch({ id: 'waiting', round: 9 }),
    ]
    expect(nextWaitingMatchId(matches)).toBe('waiting')
  })

  it('returns null when nobody is waiting', () => {
    expect(nextWaitingMatchId([queueMatch({ player1Id: null })])).toBeNull()
    expect(nextWaitingMatchId([])).toBeNull()
  })
})

describe('assignArenasAtGeneration', () => {
  beforeEach(() => {
    findMany.mockReset()
    update.mockReset()
    updateMany.mockReset()
  })

  it('assigns arenas per round group, cycling 1..arenaCount; extras stay unassigned', async () => {
    // Bracket: round 1 has 3 matches (2 arenas → third waits), round 2 restarts at arena 1.
    findMany.mockResolvedValue([
      { id: 'r1o0', round: 1, swissRound: null, bracketOrder: 0 },
      { id: 'r1o1', round: 1, swissRound: null, bracketOrder: 1 },
      { id: 'r1o2', round: 1, swissRound: null, bracketOrder: 2 },
      { id: 'r2o0', round: 2, swissRound: null, bracketOrder: 0 },
    ] as never)
    await assignArenasAtGeneration('stage1', 2)
    expect(update.mock.calls.map(([args]) => [args.where.id, args.data.arenaNumber])).toEqual([
      ['r1o0', 1],
      ['r1o1', 2],
      ['r2o0', 1], // a new group cycles the arena numbers independently
    ])
    expect(update).toHaveBeenCalledTimes(3) // r1o2 (index 2 ≥ arenaCount) got nothing
  })

  it('groups Swiss matches by swissRound, not round', async () => {
    findMany.mockResolvedValue([
      { id: 's2', round: 0, swissRound: 2, bracketOrder: 1 },
      { id: 's1', round: 0, swissRound: 2, bracketOrder: 0 },
      { id: 's3', round: 0, swissRound: 3, bracketOrder: 0 },
    ] as never)
    await assignArenasAtGeneration('stage1', 2)
    expect(update.mock.calls.map(([args]) => [args.where.id, args.data.arenaNumber])).toEqual([
      ['s1', 1], // bracketOrder wins inside the group, whatever the row order
      ['s2', 2],
      ['s3', 1],
    ])
  })

  it('issues no updates when there is nothing to assign', async () => {
    findMany.mockResolvedValue([] as never)
    await assignArenasAtGeneration('stage1', 4)
    expect(update).not.toHaveBeenCalled()
  })
})

describe('assignFreedArena (dynamic pass)', () => {
  beforeEach(() => {
    findMany.mockReset()
    update.mockReset()
    updateMany.mockReset()
  })

  it('is a no-op when the completed match had no arena', async () => {
    await assignFreedArena({ id: 'm1', stageId: 'stage1', arenaNumber: null })
    expect(findMany).not.toHaveBeenCalled()
    expect(updateMany).not.toHaveBeenCalled()
  })

  it('hands the freed arena to the next waiting match of the same stage', async () => {
    findMany.mockResolvedValue([
      queueMatch({ id: 'blocked', round: 1, player2Id: null }),
      queueMatch({ id: 'next', round: 2, bracketOrder: 1 }),
      queueMatch({ id: 'later', round: 2, bracketOrder: 3 }),
    ] as never)
    updateMany.mockResolvedValue({ count: 1 } as never)
    await assignFreedArena({ id: 'done', stageId: 'stage1', arenaNumber: 2 })
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ stageId: 'stage1', arenaNumber: null, status: 'PENDING' }) })
    )
    expect(updateMany).toHaveBeenCalledTimes(1)
    expect(updateMany).toHaveBeenCalledWith({ where: { id: 'next', arenaNumber: null }, data: { arenaNumber: 2 } })
  })

  it('re-queues behind a lost race instead of double-booking (fixpoint loop)', async () => {
    findMany
      .mockResolvedValueOnce([queueMatch({ id: 'claimed', round: 1 }), queueMatch({ id: 'runner-up', round: 2 })] as never)
      .mockResolvedValueOnce([queueMatch({ id: 'runner-up', round: 2 })] as never)
    updateMany
      .mockResolvedValueOnce({ count: 0 } as never) // a concurrent completion claimed 'claimed'
      .mockResolvedValueOnce({ count: 1 } as never)
    await assignFreedArena({ id: 'done', stageId: 'stage1', arenaNumber: 1 })
    expect(updateMany).toHaveBeenCalledTimes(2)
    expect(updateMany).toHaveBeenLastCalledWith({ where: { id: 'runner-up', arenaNumber: null }, data: { arenaNumber: 1 } })
  })

  it('stops when nobody is waiting', async () => {
    findMany.mockResolvedValue([queueMatch({ id: 'empty-slot', player1Id: null })] as never)
    await assignFreedArena({ id: 'done', stageId: 'stage1', arenaNumber: 3 })
    expect(updateMany).not.toHaveBeenCalled()
  })
})
