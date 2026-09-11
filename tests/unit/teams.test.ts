// tests/unit/teams.test.ts (RC15, issue #12)
// Direct unit coverage for lib/teams.ts — the pure team rulebook: name validation, the
// 3-member roster/lineup cardinality, and the best-of-3 encounter state machine. No DB/HTTP.

import { describe, it, expect } from 'vitest'
import {
  validateTeamName,
  lineupError,
  encounterState,
  encounterGamePlayers,
  TEAM_SIZE,
} from '@/lib/teams'

describe('validateTeamName', () => {
  it('accepts a normal name and returns the trimmed canonical form', () => {
    expect(validateTeamName('  Drachen-Wirbel  ')).toEqual({ ok: true, name: 'Drachen-Wirbel' })
  })

  it('accepts the bounds exactly (2 and 40 chars)', () => {
    expect(validateTeamName('ab')).toEqual({ ok: true, name: 'ab' })
    expect(validateTeamName('a'.repeat(40))).toEqual({ ok: true, name: 'a'.repeat(40) })
  })

  it('rejects non-strings, empty/whitespace and out-of-bounds lengths', () => {
    expect(validateTeamName(undefined)).toEqual({ ok: false, error: 'invalid_name' })
    expect(validateTeamName(42)).toEqual({ ok: false, error: 'invalid_name' })
    expect(validateTeamName('   ')).toEqual({ ok: false, error: 'invalid_name' })
    expect(validateTeamName('x')).toEqual({ ok: false, error: 'invalid_name' })
    expect(validateTeamName('a'.repeat(41))).toEqual({ ok: false, error: 'invalid_name' })
  })
})

describe('lineupError — the lineup IS the roster: exactly 3 members', () => {
  it('null (= registrable) at exactly TEAM_SIZE members', () => {
    expect(lineupError(TEAM_SIZE)).toBeNull()
  })

  it('team_incomplete below 3, roster_full above 3', () => {
    expect(lineupError(2)).toBe('team_incomplete')
    expect(lineupError(0)).toBe('team_incomplete')
    expect(lineupError(4)).toBe('roster_full')
  })
})

describe('encounterState — best-of-3, first to 2', () => {
  const game = (status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED', winnerSide: 1 | 2 | null = null) => ({ status, winnerSide })

  it('no games played → PENDING with zero wins', () => {
    expect(encounterState([game('PENDING'), game('PENDING'), game('PENDING')])).toEqual({
      status: 'PENDING', winsTeam1: 0, winsTeam2: 0, winnerSide: null,
    })
  })

  it('a single finished game → IN_PROGRESS, no winner yet', () => {
    expect(encounterState([game('COMPLETED', 1), game('PENDING'), game('PENDING')])).toEqual({
      status: 'IN_PROGRESS', winsTeam1: 1, winsTeam2: 0, winnerSide: null,
    })
  })

  it('2-0 ends the encounter immediately — game 3 is never needed', () => {
    expect(encounterState([game('COMPLETED', 2), game('COMPLETED', 2), game('PENDING')])).toEqual({
      status: 'COMPLETED', winsTeam1: 0, winsTeam2: 2, winnerSide: 2,
    })
  })

  it('2-1 after three games → COMPLETED for the 2-win side', () => {
    expect(encounterState([game('COMPLETED', 1), game('COMPLETED', 2), game('COMPLETED', 1)])).toEqual({
      status: 'COMPLETED', winsTeam1: 2, winsTeam2: 1, winnerSide: 1,
    })
  })

  it('defensive: all games completed without a 2-win threshold → the leader wins', () => {
    // Cannot happen with 3 games, but the encounter must never hang open forever.
    expect(encounterState([game('COMPLETED', 1), game('COMPLETED', 1), game('COMPLETED', 1)].slice(0, 2))).toEqual({
      status: 'COMPLETED', winsTeam1: 2, winsTeam2: 0, winnerSide: 1,
    })
  })
})

describe('encounterGamePlayers — fixed slot-vs-slot pairing', () => {
  const slots = (prefix: string) => [
    { position: 2, userId: `${prefix}-2` },
    { position: 1, userId: `${prefix}-1` },
    { position: 3, userId: `${prefix}-3` },
  ]

  it('pairs slot i of team 1 against slot i of team 2 regardless of input order', () => {
    expect(encounterGamePlayers(slots('a'), slots('b'))).toEqual([
      { player1Id: 'a-1', player2Id: 'b-1' },
      { player1Id: 'a-2', player2Id: 'b-2' },
      { player1Id: 'a-3', player2Id: 'b-3' },
    ])
  })

  it('throws loudly on an incomplete lineup (server bug, never a silent undefined pairing)', () => {
    expect(() => encounterGamePlayers([{ position: 1, userId: 'a-1' }], slots('b'))).toThrow('encounter_lineup_incomplete')
    expect(() => encounterGamePlayers(slots('a'), [{ position: 1, userId: 'b-1' }, { position: 2, userId: 'b-2' }, { position: 4, userId: 'b-4' }])).toThrow('encounter_lineup_incomplete')
  })
})
