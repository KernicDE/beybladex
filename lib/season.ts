// lib/season.ts (Phase 14)
// Season/PlayerRating write path — kept separate from the score route so it can be unit- and
// integration-tested without going through the full match-scoring flow.
import type { Prisma, PrismaClient } from '@prisma/client'
import { applyEloResult } from '@/lib/elo'

type Tx = PrismaClient | Prisma.TransactionClient

export async function getActiveSeason(tx: Tx) {
  return tx.season.findFirst({ where: { status: 'ACTIVE' } })
}

// Applies one match result to both players' current-season PlayerRating, creating a row (Elo
// 1000, per the model default) on a player's first appearance in the season. Called from the
// match-completion write path — see app/api/matches/[id]/score/route.ts's own comment on why
// this runs synchronously in the same transaction as the match update (exactly two rows change
// per match, not an unbounded fan-out, so no dirty-set/async recompute is needed here unlike
// Phase 5 Part D's Auto-Meta cache).
export async function applyMatchResultToRatings(
  tx: Tx,
  seasonId: string,
  winnerId: string,
  loserId: string
): Promise<void> {
  const [winnerRating, loserRating] = await Promise.all([
    tx.playerRating.upsert({
      where: { seasonId_userId: { seasonId, userId: winnerId } },
      create: { seasonId, userId: winnerId },
      update: {},
    }),
    tx.playerRating.upsert({
      where: { seasonId_userId: { seasonId, userId: loserId } },
      create: { seasonId, userId: loserId },
      update: {},
    }),
  ])

  const winnerResult = applyEloResult(winnerRating.elo, loserRating.elo, 1, winnerRating.gamesPlayed)
  const loserResult = applyEloResult(loserRating.elo, winnerRating.elo, 0, loserRating.gamesPlayed)

  await Promise.all([
    tx.playerRating.update({
      where: { id: winnerRating.id },
      data: {
        elo: winnerResult.newElo,
        peakElo: Math.max(winnerRating.peakElo, winnerResult.newElo),
        gamesPlayed: { increment: 1 },
      },
    }),
    tx.playerRating.update({
      where: { id: loserRating.id },
      data: {
        elo: loserResult.newElo,
        peakElo: Math.max(loserRating.peakElo, loserResult.newElo),
        gamesPlayed: { increment: 1 },
      },
    }),
  ])
}
