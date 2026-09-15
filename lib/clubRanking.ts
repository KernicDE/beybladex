// lib/clubRanking.ts (issue #199 — Club-Rangliste)
// Club rank has no directly-measured value (a club doesn't play matches, its members do) — it's
// always an AGGREGATION of member Elo. The issue's own concept comment flagged this as a
// product decision ("SUMME (großer Club gewinnt automatisch) oder SCHNITT (kleiner, starker
// Club kann vorne stehen)?"); the user's answer: show BOTH, sum and average, side by side —
// no single "the" club ranking metric.
//
// Eligibility: a club needs at least MIN_RATED_MEMBERS members individually rated this season
// (PlayerRating.gamesPlayed >= MIN_RATED_GAMES_FOR_LADDER) to appear at all — otherwise a
// single active player could make a one-person "club" top the average column, which isn't a
// meaningful club comparison.
import { prisma } from '@/lib/db'
import { MIN_RATED_GAMES_FOR_LADDER } from '@/lib/elo'

export const MIN_CLUB_RATED_MEMBERS = 3

export interface ClubRankingRow {
  clubId: string
  name: string
  slug: string
  ratedMemberCount: number
  sumElo: number
  avgElo: number
}

export interface ClubRankingClubInput {
  id: string
  name: string
  slug: string
  memberUserIds: string[]
}

/** Pure aggregation over already-fetched rows — unit-testable without mocking Prisma. */
export function aggregateClubRanking(clubs: ClubRankingClubInput[], eloByUser: Map<string, number>): ClubRankingRow[] {
  return clubs
    .map((c) => {
      const elos = c.memberUserIds.map((userId) => eloByUser.get(userId)).filter((e): e is number => e !== undefined)
      const sumElo = elos.reduce((a, b) => a + b, 0)
      return {
        clubId: c.id,
        name: c.name,
        slug: c.slug,
        ratedMemberCount: elos.length,
        sumElo,
        avgElo: elos.length ? Math.round(sumElo / elos.length) : 0,
      }
    })
    .filter((r) => r.ratedMemberCount >= MIN_CLUB_RATED_MEMBERS)
}

export async function computeClubRanking(seasonId: string): Promise<ClubRankingRow[]> {
  const clubs = await prisma.club.findMany({
    select: { id: true, name: true, slug: true, members: { where: { status: 'ACTIVE' }, select: { userId: true } } },
  })
  const allUserIds = clubs.flatMap((c) => c.members.map((m) => m.userId))
  const ratings = allUserIds.length
    ? await prisma.playerRating.findMany({
        where: { seasonId, userId: { in: allUserIds }, gamesPlayed: { gte: MIN_RATED_GAMES_FOR_LADDER } },
        select: { userId: true, elo: true },
      })
    : []
  const eloByUser = new Map(ratings.map((r) => [r.userId, r.elo]))

  return aggregateClubRanking(
    clubs.map((c) => ({ id: c.id, name: c.name, slug: c.slug, memberUserIds: c.members.map((m) => m.userId) })),
    eloByUser,
  )
}
