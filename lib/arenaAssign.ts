// lib/arenaAssign.ts
// Phase 7 — arena/stadium assignment for tournaments with Tournament.arenaCount set.
//
// Two passes, both stage-scoped:
//   assignArenasAtGeneration — after a stage's matches are created (generate route). Matches are
//     grouped by their ordering key (bracket/round-robin: round; Swiss: swissRound) and, within a
//     group, ordered by bracketOrder. The first arenaCount matches of a group get arenas 1..N in
//     that order (each group cycles the arena numbers independently); matches beyond the first
//     arenaCount of their group stay arenaNumber = null — they wait for the dynamic pass.
//   assignFreedArena — dynamic pass when a match transitions to COMPLETED (score route) or is
//     auto-completed by the no-show route: the freed arena number goes to the next waiting match.
//
// QUEUE-ORDERING RULE (documented decision): the next waiting match is the PENDING match with
// arenaNumber = null and BOTH players set, ordered by lowest round first, then lowest swissRound,
// then lowest bracketOrder. Matches missing a player can never start, so they must not block the
// queue. Assignment itself does not complete matches, so one pass normally suffices; the
// guard-capped loop is a safety fixpoint (modeled on lib/stageFlow.ts's resolveStuckByes) that
// also closes the race where a concurrent completion claimed the same candidate first — a lost
// updateMany re-queues the arena rather than double-booking it.
import { prisma } from '@/lib/db'
import type { Match } from '@prisma/client'
import type { Prisma, PrismaClient } from '@prisma/client'
import { notifyArenaAssigned } from '@/lib/notify'

// [RC2 #41] assignFreedArena accepts an optional client so the score route can run the arena
// hand-off inside the SAME transaction as the completion (see lib/stageFlow.ts's header).
type Db = PrismaClient | Prisma.TransactionClient

// Phase 18 item 2 — best-effort notification wrapper: an arena assignment is already persisted
// by the caller before this runs; a notification-delivery hiccup must never fail that write.
async function notifyArena(matchId: string, arenaNumber: number): Promise<void> {
  try {
    await notifyArenaAssigned(matchId, arenaNumber)
  } catch (err) {
    console.error(`[arenaAssign] notifyArenaAssigned(${matchId}) failed:`, err)
  }
}

export type ArenaQueueMatch = Pick<
  Match,
  'id' | 'round' | 'swissRound' | 'bracketOrder' | 'status' | 'arenaNumber' | 'player1Id' | 'player2Id'
>

const QUEUE_ORDER = [{ round: 'asc' }, { swissRound: 'asc' }, { bracketOrder: 'asc' }] as const

/** Organizer-facing bound for arenaCount (body validation): integer 1..64, null = absent/invalid. */
export function parseArenaCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 64 ? value : null
}

/** Arena for the i-th match (0-based) within its round group: 1..arenaCount cycling, then null. */
export function arenaForIndex(index: number, arenaCount: number): number | null {
  return index < arenaCount ? index + 1 : null
}

/**
 * Pure queue pick (unit-tested without a DB): the first match that is PENDING, unassigned, and
 * has both players — queue order is round asc, then swissRound asc, then bracketOrder asc.
 * Returns null when nobody is waiting.
 */
export function nextWaitingMatchId(matches: ArenaQueueMatch[]): string | null {
  const waiting = matches.filter(
    (m) => m.status === 'PENDING' && m.arenaNumber === null && m.player1Id !== null && m.player2Id !== null
  )
  // swissRound nulls sort LAST, matching the DB's ASC ordering (a Swiss round number never
  // competes with a bracket round number within one stage anyway).
  waiting.sort(
    (a, b) =>
      a.round - b.round ||
      (a.swissRound ?? Number.POSITIVE_INFINITY) - (b.swissRound ?? Number.POSITIVE_INFINITY) ||
      a.bracketOrder - b.bracketOrder
  )
  return waiting[0]?.id ?? null
}

/** Initial 1:1 assignment right after a stage's matches were generated. */
export async function assignArenasAtGeneration(stageId: string, arenaCount: number): Promise<void> {
  const matches = await prisma.match.findMany({
    where: { stageId, status: { not: 'COMPLETED' } },
    select: { id: true, round: true, swissRound: true, bracketOrder: true },
    orderBy: [...QUEUE_ORDER],
  })
  // Group key: swissRound when set (Swiss/round-robin display grouping), else round. Within a
  // group the bracketOrder decides — sorted here too (not only via the DB's orderBy) so the
  // assignment is correct no matter the row order the query returns.
  const groups = new Map<number, { id: string; bracketOrder: number }[]>()
  for (const m of matches) {
    const key = m.swissRound ?? m.round
    const list = groups.get(key) ?? []
    list.push({ id: m.id, bracketOrder: m.bracketOrder })
    groups.set(key, list)
  }
  for (const group of groups.values()) {
    group.sort((a, b) => a.bracketOrder - b.bracketOrder)
    for (const [i, m] of group.entries()) {
      const arena = arenaForIndex(i, arenaCount)
      if (arena === null) continue // beyond arenaCount in this group — waits for the dynamic pass
      await prisma.match.update({ where: { id: m.id }, data: { arenaNumber: arena } })
      await notifyArena(m.id, arena)
    }
  }
}

/**
 * Hand the arena freed by a COMPLETED match to the next waiting match in the same stage.
 * No-op when the completed match had no arena (arena management off or an unassigned match).
 */
export async function assignFreedArena(completedMatch: Pick<Match, 'id' | 'stageId' | 'arenaNumber'>, db: Db = prisma): Promise<void> {
  if (completedMatch.arenaNumber === null) return
  for (let guard = 0; guard < 16; guard++) {
    const waiting = await db.match.findMany({
      where: {
        stageId: completedMatch.stageId,
        arenaNumber: null,
        status: 'PENDING',
        player1Id: { not: null },
        player2Id: { not: null },
      },
      select: { id: true, round: true, swissRound: true, bracketOrder: true, status: true, arenaNumber: true, player1Id: true, player2Id: true },
      orderBy: [...QUEUE_ORDER],
    })
    const nextId = nextWaitingMatchId(waiting)
    if (nextId === null) return
    // Claim atomically: a concurrent completion that got here first leaves arenaNumber set and
    // the updateMany matches nothing — loop and queue the arena behind it instead of double-booking.
    const { count } = await db.match.updateMany({
      where: { id: nextId, arenaNumber: null },
      data: { arenaNumber: completedMatch.arenaNumber },
    })
    if (count > 0) {
      await notifyArena(nextId, completedMatch.arenaNumber)
      return
    }
  }
}
