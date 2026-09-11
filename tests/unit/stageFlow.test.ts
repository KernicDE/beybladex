// tests/unit/stageFlow.test.ts (RC6, issue #35)
// Direct unit coverage for lib/stageFlow.ts — the tournament-progression engine's persistence
// layer. Every stageFlow helper takes an optional client ([RC2 #41] transaction seam), so the
// tests drive it with an in-memory fake DB: real propagation logic (winner forwarding, LB
// drop-in, elimination, grand-final reset wiring, stuck-bye resolution, Swiss standings +
// Buchholz) against a store we can assert on — no HTTP, no real database. The bracket SHAPE
// underneath is the already-tested pure libs (lib/doubleElimination.ts, lib/swiss.ts); these
// tests pin how stageFlow PERSISTS their results. '@/lib/notify' is Seam-Mocked (Redis side
// effects must never run in a unit test).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const notifyMatchReady = vi.fn()
vi.mock('@/lib/notify', () => ({ notifyMatchReady: (...a: unknown[]) => notifyMatchReady(...a) }))
// Imported for its default-param side only; every call below passes the fake explicitly.
vi.mock('@/lib/db', () => ({ prisma: {} }))

import {
  slotFeeder,
  propagateEliminationResult,
  resolveStuckByes,
  recordSwissResult,
} from '@/lib/stageFlow'
import type { Prisma } from '@prisma/client'

type Row = Record<string, unknown>
type Where = Record<string, unknown>

function applyData(row: Row, data: Row) {
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'object' && value !== null) {
      if ('increment' in value) row[key] = (row[key] as number) + (value as { increment: number }).increment
      else if ('push' in value) (row[key] as unknown[]).push((value as { push: unknown }).push)
      else row[key] = value
    } else {
      row[key] = value
    }
  }
}

function rowMatches(row: Row, where: Where): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (typeof value === 'object' && value !== null && 'in' in value) {
      if (!(value as { in: unknown[] }).in.includes(row[key])) return false
    } else if (row[key] !== value) {
      return false
    }
  }
  return true
}

/** Minimal in-memory stand-in for the Prisma methods stageFlow actually calls (synchronous —
 *  stageFlow awaits the results, and awaiting a plain value is harmless). */
function fakeDb(initial: { matches?: Row[]; standings?: Row[] }) {
  const matches = initial.matches ?? []
  const standings = initial.standings ?? []
  return {
    match: {
      updateMany: ({ where, data }: { where: Where; data: Row }) => {
        let count = 0
        for (const m of matches) if (rowMatches(m, where)) { applyData(m, data); count++ }
        return { count }
      },
      findFirst: ({ where }: { where: Where }) => matches.find((m) => rowMatches(m, where)) ?? null,
      findUnique: ({ where }: { where: Where }) => matches.find((m) => rowMatches(m, where)) ?? null,
      findMany: ({ where }: { where: Where }) => matches.filter((m) => rowMatches(m, where)),
      update: ({ where, data }: { where: Where; data: Row }) => {
        const m = matches.find((m) => rowMatches(m, where))
        if (!m) throw new Error('fake db: match not found')
        applyData(m, data)
        return m
      },
      deleteMany: ({ where }: { where: Where }) => {
        const before = matches.length
        for (let i = matches.length - 1; i >= 0; i--) if (rowMatches(matches[i], where)) matches.splice(i, 1)
        return { count: before - matches.length }
      },
    },
    stageStanding: {
      updateMany: ({ where, data }: { where: Where; data: Row }) => {
        let count = 0
        for (const s of standings) if (rowMatches(s, where)) { applyData(s, data); count++ }
        return { count }
      },
      findMany: ({ where }: { where: Where }) => standings.filter((s) => rowMatches(s, where)),
    },
  }
}

type FakeDb = ReturnType<typeof fakeDb>
/** The fake is structurally what stageFlow calls; the cast enters it through the `Db` seam. */
const asDb = (db: FakeDb) => db as unknown as Prisma.TransactionClient

const STAGE = 'stage-1'
// Double-elimination topology for all propagation tests: 8 slots → R = 3, GF at round 8.
const SLOTS = 8

function matchRow(overrides: Row): Row {
  return {
    id: `m-${overrides.round}-${overrides.bracketOrder}`,
    stageId: STAGE,
    bracketSide: null,
    player1Id: null,
    player2Id: null,
    winnerId: null,
    status: 'PENDING',
    ...overrides,
  }
}

beforeEach(() => {
  notifyMatchReady.mockReset()
  notifyMatchReady.mockResolvedValue(undefined)
})

describe('slotFeeder (pure reverse mapping of the LB wiring)', () => {
  const R = 3
  it('LB round 1 (j=1): both slots fed by adjacent WB round-1 losers', () => {
    expect(slotFeeder(R + 1, 0, 'player1Id', SLOTS)).toEqual({ round: 1, bracketOrder: 0 })
    expect(slotFeeder(R + 1, 0, 'player2Id', SLOTS)).toEqual({ round: 1, bracketOrder: 1 })
    expect(slotFeeder(R + 1, 1, 'player1Id', SLOTS)).toEqual({ round: 1, bracketOrder: 2 })
  })

  it('drop-in round (j=2): player1 = LB continuation, player2 = WB drop-in loser', () => {
    expect(slotFeeder(R + 2, 1, 'player1Id', SLOTS)).toEqual({ round: R + 1, bracketOrder: 1 })
    expect(slotFeeder(R + 2, 1, 'player2Id', SLOTS)).toEqual({ round: 2, bracketOrder: 1 })
  })

  it('consolidation round (j=3): both slots from the previous LB round via floor(i/2)', () => {
    expect(slotFeeder(R + 3, 0, 'player1Id', SLOTS)).toEqual({ round: R + 2, bracketOrder: 0 })
    expect(slotFeeder(R + 3, 1, 'player2Id', SLOTS)).toEqual({ round: R + 2, bracketOrder: 0 })
  })

  it('grand final / reset are never fed by a loser drop-in', () => {
    expect(slotFeeder(3 * R - 1, 0, 'player1Id', SLOTS)).toBeNull()
    expect(slotFeeder(3 * R - 1, 1, 'player2Id', SLOTS)).toBeNull()
  })
})

describe('propagateEliminationResult (double-elimination)', () => {
  it('WB match: winner fills the next WB slot, loser drops into the mapped LB slot', async () => {
    const db = fakeDb({
      matches: [
        matchRow({ round: 2, bracketOrder: 1, bracketSide: 'WINNERS', player1Id: 'a', player2Id: 'b' }),
        matchRow({ round: 3, bracketOrder: 0, bracketSide: 'WINNERS' }), // WB final slot
        matchRow({ round: 5, bracketOrder: 1, bracketSide: 'LOSERS' }), // LB drop-in slot
      ],
    })
    await propagateEliminationResult(
      { id: 'm-2-1', stageId: STAGE, round: 2, bracketOrder: 1, bracketSide: 'WINNERS', player1Id: 'a', player2Id: 'b' },
      'a',
      SLOTS,
      asDb(db)
    )
    // winnerPropagation(WB r2 o1) → (r3, o0, player2); loserPropagation → LB (r5, o1, player2).
    expect(db.match.findFirst({ where: { round: 3, bracketOrder: 0 } })).toMatchObject({ player2Id: 'a' })
    expect(db.match.findFirst({ where: { round: 5, bracketOrder: 1 } })).toMatchObject({ player2Id: 'b' })
  })

  it('LB match: winner advances to the grand final (player2 slot), loser is eliminated', async () => {
    const db = fakeDb({
      matches: [
        matchRow({ round: 7, bracketOrder: 0, bracketSide: 'LOSERS', player1Id: 'x', player2Id: 'y' }),
        matchRow({ round: 8, bracketOrder: 0, bracketSide: 'GRAND_FINAL' }),
        matchRow({ round: 8, bracketOrder: 1, bracketSide: 'GRAND_FINAL' }), // reset
      ],
      standings: [
        { stageId: STAGE, userId: 'x', wins: 0, losses: 0, buchholz: 0, opponentIds: [], byes: 0, eliminated: false },
        { stageId: STAGE, userId: 'y', wins: 0, losses: 0, buchholz: 0, opponentIds: [], byes: 0, eliminated: false },
      ],
    })
    await propagateEliminationResult(
      { id: 'm-7-0', stageId: STAGE, round: 7, bracketOrder: 0, bracketSide: 'LOSERS', player1Id: 'x', player2Id: 'y' },
      'x',
      SLOTS,
      asDb(db)
    )
    expect(db.match.findFirst({ where: { round: 8, bracketOrder: 0 } })).toMatchObject({ player2Id: 'x' })
    expect(db.stageStanding.findMany({ where: { stageId: STAGE, userId: 'y' } })[0]).toMatchObject({ eliminated: true })
    expect(db.stageStanding.findMany({ where: { stageId: STAGE, userId: 'x' } })[0]).toMatchObject({ eliminated: false })
  })

  it('grand final won by the LB champion populates the reset match (WB champion must be beaten twice)', async () => {
    const db = fakeDb({
      matches: [
        matchRow({ round: 8, bracketOrder: 0, bracketSide: 'GRAND_FINAL', player1Id: 'wb', player2Id: 'lb' }),
        matchRow({ round: 8, bracketOrder: 1, bracketSide: 'GRAND_FINAL' }),
      ],
    })
    await propagateEliminationResult(
      { id: 'm-8-0', stageId: STAGE, round: 8, bracketOrder: 0, bracketSide: 'GRAND_FINAL', player1Id: 'wb', player2Id: 'lb' },
      'lb',
      SLOTS,
      asDb(db)
    )
    expect(db.match.findFirst({ where: { round: 8, bracketOrder: 1 } })).toMatchObject({ player1Id: 'wb', player2Id: 'lb' })
    expect(notifyMatchReady).toHaveBeenCalledWith('m-8-1')
  })

  it('grand final won by the WB champion deletes the reset match (the one node that may never be played)', async () => {
    const db = fakeDb({
      matches: [
        matchRow({ round: 8, bracketOrder: 0, bracketSide: 'GRAND_FINAL', player1Id: 'wb', player2Id: 'lb' }),
        matchRow({ round: 8, bracketOrder: 1, bracketSide: 'GRAND_FINAL' }),
      ],
    })
    await propagateEliminationResult(
      { id: 'm-8-0', stageId: STAGE, round: 8, bracketOrder: 0, bracketSide: 'GRAND_FINAL', player1Id: 'wb', player2Id: 'lb' },
      'wb',
      SLOTS,
      asDb(db)
    )
    expect(db.match.findFirst({ where: { round: 8, bracketOrder: 1 } })).toBeNull()
    expect(notifyMatchReady).not.toHaveBeenCalledWith('m-8-1')
  })
})

describe('resolveStuckByes (LB match whose sibling feeder can never deliver)', () => {
  it('auto-completes the live player as a bye and propagates the win onward', async () => {
    const db = fakeDb({
      matches: [
        // LB round 1 (round 4), order 0: one live player, sibling feeder WB (1,1) is a COMPLETED bye.
        matchRow({ round: 4, bracketOrder: 0, bracketSide: 'LOSERS', player1Id: 'live' }),
        matchRow({ round: 1, bracketOrder: 1, bracketSide: 'WINNERS', player1Id: 'bye2', player2Id: null, winnerId: 'bye2', status: 'COMPLETED' }),
        matchRow({ round: 5, bracketOrder: 0, bracketSide: 'LOSERS' }), // target of the bye win
      ],
    })
    await resolveStuckByes(STAGE, SLOTS, asDb(db))
    expect(db.match.findFirst({ where: { round: 4, bracketOrder: 0 } })).toMatchObject({ status: 'COMPLETED', winnerId: 'live' })
    // LB (4,0) winner → (5,0, player1): the win propagates so the bracket keeps flowing.
    expect(db.match.findFirst({ where: { round: 5, bracketOrder: 0 } })).toMatchObject({ player1Id: 'live' })
  })

  it('leaves the match open while its feeder is still undecided (PENDING feeder proves nothing)', async () => {
    const db = fakeDb({
      matches: [
        matchRow({ round: 4, bracketOrder: 0, bracketSide: 'LOSERS', player1Id: 'live' }),
        matchRow({ round: 1, bracketOrder: 1, bracketSide: 'WINNERS', player1Id: 'c', player2Id: 'd', status: 'PENDING' }),
      ],
    })
    await resolveStuckByes(STAGE, SLOTS, asDb(db))
    expect(db.match.findFirst({ where: { round: 4, bracketOrder: 0 } })).toMatchObject({ status: 'PENDING', winnerId: null })
  })
})

describe('recordSwissResult (standings-ranked formats: wins/losses + Buchholz)', () => {
  it('increments wins/losses, records opponent history and recomputes Buchholz for the whole stage', async () => {
    const db = fakeDb({
      standings: [
        { stageId: STAGE, userId: 'A', wins: 1, losses: 0, buchholz: 0, opponentIds: ['C'], byes: 0, eliminated: false },
        { stageId: STAGE, userId: 'B', wins: 2, losses: 0, buchholz: 0, opponentIds: ['C'], byes: 0, eliminated: false },
        { stageId: STAGE, userId: 'C', wins: 0, losses: 0, buchholz: 0, opponentIds: [], byes: 0, eliminated: false },
      ],
    })
    await recordSwissResult(STAGE, 'A', 'C', asDb(db))
    const standing = (u: string) => db.stageStanding.findMany({ where: { stageId: STAGE, userId: u } })[0]
    expect(standing('A')).toMatchObject({ wins: 2, losses: 0, opponentIds: ['C', 'C'] })
    expect(standing('C')).toMatchObject({ wins: 0, losses: 1, opponentIds: ['A'] })
    // Buchholz = sum of CURRENT opponents' win counts: A played C,C (0+0); B played C (0);
    // C played A (2).
    expect(standing('A').buchholz).toBe(0)
    expect(standing('B').buchholz).toBe(0)
    expect(standing('C').buchholz).toBe(2)
  })

  it('a bye (loserId null) awards the win without a loss or opponent entry', async () => {
    const db = fakeDb({
      standings: [
        { stageId: STAGE, userId: 'A', wins: 0, losses: 0, buchholz: 0, opponentIds: [], byes: 0, eliminated: false },
      ],
    })
    await recordSwissResult(STAGE, 'A', null, asDb(db))
    const standing = db.stageStanding.findMany({ where: { stageId: STAGE, userId: 'A' } })[0]
    expect(standing).toMatchObject({ wins: 1, losses: 0, opponentIds: [], buchholz: 0 })
  })
})
