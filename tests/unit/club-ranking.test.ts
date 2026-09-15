// tests/unit/club-ranking.test.ts (issue #199)
// Direct unit coverage for lib/clubRanking.ts's pure aggregation: sum + average member Elo
// (per the user's decision — both, not one or the other), gated on a minimum rated-member
// count so a one-person "club" can't top the average column.
import { describe, it, expect } from 'vitest'
import { aggregateClubRanking, MIN_CLUB_RATED_MEMBERS } from '@/lib/clubRanking'

describe('aggregateClubRanking', () => {
  it('computes sum and average Elo over only the RATED members', () => {
    const elo = new Map([['a', 1200], ['b', 1000], ['c', 800]])
    const rows = aggregateClubRanking(
      [{ id: 'club-1', name: 'Club A', slug: 'club-a', memberUserIds: ['a', 'b', 'c'] }],
      elo,
    )
    expect(rows).toEqual([{ clubId: 'club-1', name: 'Club A', slug: 'club-a', ratedMemberCount: 3, sumElo: 3000, avgElo: 1000 }])
  })

  it('excludes unrated members from both the sum and the average', () => {
    const elo = new Map([['a', 1200], ['b', 1000], ['c', 800]])
    const rows = aggregateClubRanking(
      [{ id: 'club-1', name: 'Club A', slug: 'club-a', memberUserIds: ['a', 'b', 'c', 'unrated-d'] }],
      elo,
    )
    expect(rows[0]).toMatchObject({ ratedMemberCount: 3, sumElo: 3000, avgElo: 1000 })
  })

  it(`drops a club below ${MIN_CLUB_RATED_MEMBERS} rated members entirely (a 1-2 person "club" can't top the average column)`, () => {
    const elo = new Map([['a', 1200], ['b', 1000]])
    const rows = aggregateClubRanking(
      [{ id: 'club-1', name: 'Tiny Club', slug: 'tiny', memberUserIds: ['a', 'b'] }],
      elo,
    )
    expect(rows).toEqual([])
  })

  it('rounds average Elo to the nearest integer', () => {
    const elo = new Map([['a', 1000], ['b', 1001], ['c', 1001]])
    const rows = aggregateClubRanking(
      [{ id: 'club-1', name: 'Club A', slug: 'club-a', memberUserIds: ['a', 'b', 'c'] }],
      elo,
    )
    expect(rows[0]!.avgElo).toBe(1001) // 3002/3 = 1000.666… → 1001
  })
})
