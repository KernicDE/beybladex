// tests/unit/player-stats.test.ts (issue #199)
// Direct unit coverage for lib/playerStats.ts's pure aggregation — the scope-agnostic stat
// counts (matches/wins/losses/rounds/tournaments/best+avg placement) that extend to Year/
// All-time scope, unlike Elo (which stays Season-only, see the module's own header comment).
import { describe, it, expect } from 'vitest'
import { aggregatePlayerStats, yearScope } from '@/lib/playerStats'

describe('aggregatePlayerStats', () => {
  it('counts matches, rounds and win/loss for both players of each match', () => {
    const stats = aggregatePlayerStats(
      [
        { player1Id: 'a', player2Id: 'b', winnerId: 'a', scorePlayer1: 3, scorePlayer2: 1 },
        { player1Id: 'b', player2Id: 'a', winnerId: 'b', scorePlayer1: 3, scorePlayer2: 2 },
      ],
      [],
    )
    expect(stats.get('a')).toMatchObject({ matchesPlayed: 2, wins: 1, losses: 1, roundsPlayed: 4 + 5 })
    expect(stats.get('b')).toMatchObject({ matchesPlayed: 2, wins: 1, losses: 1, roundsPlayed: 9 })
  })

  it('a draw-shaped match (no winnerId, e.g. an aborted match) counts for neither win nor loss', () => {
    const stats = aggregatePlayerStats(
      [{ player1Id: 'a', player2Id: 'b', winnerId: null, scorePlayer1: 1, scorePlayer2: 1 }],
      [],
    )
    expect(stats.get('a')).toMatchObject({ matchesPlayed: 1, wins: 0, losses: 0 })
    expect(stats.get('b')).toMatchObject({ matchesPlayed: 1, wins: 0, losses: 0 })
  })

  it('counts tournament participations and derives best/average placement, ignoring nulls', () => {
    const stats = aggregatePlayerStats(
      [],
      [
        { userId: 'a', placement: 1 },
        { userId: 'a', placement: 3 },
        { userId: 'a', placement: null }, // not yet completed / pre-feature tournament
        { userId: 'b', placement: null },
      ],
    )
    expect(stats.get('a')).toMatchObject({ tournamentsPlayed: 3, bestPlacement: 1, avgPlacement: 2 })
    expect(stats.get('b')).toMatchObject({ tournamentsPlayed: 1, bestPlacement: null, avgPlacement: null })
  })

  it('a user appearing in both matches and participations gets one merged row', () => {
    const stats = aggregatePlayerStats(
      [{ player1Id: 'a', player2Id: 'b', winnerId: 'a', scorePlayer1: 3, scorePlayer2: 0 }],
      [{ userId: 'a', placement: 1 }],
    )
    expect(stats.get('a')).toMatchObject({ matchesPlayed: 1, wins: 1, tournamentsPlayed: 1, bestPlacement: 1 })
  })
})

describe('yearScope', () => {
  it('produces a [Jan 1, next Jan 1) UTC range for the given year', () => {
    const scope = yearScope(2026)
    expect(scope.from?.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(scope.to?.toISOString()).toBe('2027-01-01T00:00:00.000Z')
  })
})
