// tests/unit/meta.test.ts
// Phase 5 Part D — the PURE half of lib/meta.ts (aggregateWinRates): in-memory match rows,
// no Prisma/Redis — a genuine unit test per the plan's file list. The DB-querying wrappers
// (computePartWinRates/computeBuildWinRates) and the Redis dirty-set machinery are covered by
// tests/integration/meta-recompute.test.ts instead.
import { describe, it, expect } from 'vitest'
import { aggregateWinRates, MIN_APPEARANCES } from '@/lib/meta'
import type { CompletedMatchRow, BuildPartsRow } from '@/lib/meta'

function bp(id: string, bladeId: string, ratchetId = 'r1', bitId = 'b1'): BuildPartsRow {
  return { id, bladeId, ratchetId, bitId }
}

/** A decisive completed match: winnerId equals one of the two player ids. */
function match(p1: string, b1: string | null, p2: string, b2: string | null, winner: string): CompletedMatchRow {
  return { player1Id: p1, player2Id: p2, player1BuildId: b1, player2BuildId: b2, winnerId: winner }
}

describe('aggregateWinRates (pure)', () => {
  it('a build with 12 wins / 3 losses computes an 80% win rate', () => {
    const matches: CompletedMatchRow[] = []
    // 15 decisive matches: build 'bx' (player p1) wins 12, loses 3 (as player1 or player2).
    for (let i = 0; i < 12; i++) matches.push(match('p1', 'bx', `opp${i}`, `ob${i}`, 'p1'))
    for (let i = 0; i < 3; i++) matches.push(match(`opp${i}`, 'bx', `opp${i + 100}`, `ob${i + 100}`, `opp${i + 100}`))
    const buildParts = new Map<string, BuildPartsRow>()
    buildParts.set('bx', bp('bx', 'bladeX'))
    for (const m of matches) {
      buildParts.set(m.player1BuildId!, bp(m.player1BuildId!, 'x'))
      buildParts.set(m.player2BuildId!, bp(m.player2BuildId!, 'y'))
    }

    const { builds } = aggregateWinRates(matches, buildParts)
    const stats = builds.get('bx')!
    expect(stats.wins).toBe(12)
    expect(stats.losses).toBe(3)
    expect(stats.appearances).toBe(15)
    expect(stats.winRate).toBe(0.8)
  })

  it('a build with only 1 appearance carries the "not enough data" marker (winRate: null)', () => {
    const matches = [match('p1', 'small', 'p2', 'ob0', 'p1')]
    const { builds } = aggregateWinRates(
      matches,
      new Map([
        ['small', bp('small', 'bladeS')],
        ['ob0', bp('ob0', 'bladeO')],
      ]),
    )
    const stats = builds.get('small')!
    expect(stats.wins).toBe(1)
    expect(stats.losses).toBe(0)
    expect(stats.appearances).toBe(1) // well below the MIN_APPEARANCES threshold
    expect(stats.winRate).toBeNull() // explicit marker, NOT a misleading 100%
  })

  it('draws (winnerId matching neither player) are excluded from the denominator defensively', () => {
    const decisive = Array.from({ length: MIN_APPEARANCES }, (_, i) => match('p1', 'bx', `o${i}`, `ob${i}`, 'p1'))
    const draw: CompletedMatchRow = { player1Id: 'p1', player2Id: 'od', player1BuildId: 'bx', player2BuildId: 'obd', winnerId: 'someone-else' }
    const buildParts = new Map<string, BuildPartsRow>(decisive.map((m) => [m.player2BuildId!, bp(m.player2BuildId!, 'z')]))
    buildParts.set('bx', bp('bx', 'bladeX'))
    buildParts.set('obd', bp('obd', 'w'))
    const { builds } = aggregateWinRates([...decisive, draw], buildParts)
    const stats = builds.get('bx')!
    expect(stats.wins).toBe(MIN_APPEARANCES) // the draw adds NEITHER a win nor a loss
    expect(stats.losses).toBe(0)
    expect(stats.appearances).toBe(MIN_APPEARANCES)
    expect(stats.winRate).toBe(1)
  })

  it('attributes wins/losses to all three parts of the confirmed build', () => {
    const matches = Array.from({ length: MIN_APPEARANCES }, (_, i) => match('p1', 'bx', `o${i}`, `ob${i}`, `o${i}`))
    const buildParts = new Map<string, BuildPartsRow>(matches.map((m) => [m.player2BuildId!, bp(m.player2BuildId!, 'other')]))
    buildParts.set('bx', bp('bx', 'bladeX', 'ratchetX', 'bitX'))
    const { parts } = aggregateWinRates(matches, buildParts)
    for (const partId of ['bladeX', 'ratchetX', 'bitX']) {
      const stats = parts.get(partId)!
      expect(stats.wins).toBe(0)
      expect(stats.losses).toBe(MIN_APPEARANCES)
      expect(stats.winRate).toBe(0)
    }
  })

  it('a side without a confirmed build (playerNBuildId null) is not attributed', () => {
    const matches = [match('p1', null, 'p2', 'bx', 'p2')]
    const { builds } = aggregateWinRates(matches, new Map([['bx', bp('bx', 'bladeX')]]))
    expect(builds.get('bx')).toMatchObject({ wins: 1, losses: 0, appearances: 1, winRate: null })
  })

  it('seeds zero entries for catalog ids with no matches when allPartIds is given', () => {
    const { parts } = aggregateWinRates([], new Map(), ['neverUsed'])
    expect(parts.get('neverUsed')).toMatchObject({ appearances: 0, wins: 0, losses: 0, winRate: null })
  })
})
