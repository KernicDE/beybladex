// lib/teamElo.ts (issue #199)
// Team-Elo write path — the exact TEAM analog of lib/season.ts's applyMatchResultToRatings,
// same Elo formula (lib/elo.ts's applyEloResult), same lazily-created-on-first-appearance
// TeamRating row (Elo 1000, per the model default). Called from lib/teamStage.ts's
// resolveTeamEncounter the moment a TeamMatch (the best-of-3 encounter, NOT an individual
// sub-game) is decided — kept separate from that file so the Elo write path is unit-testable
// without the full encounter-resolution/bracket-propagation stack.
import type { Prisma, PrismaClient } from '@prisma/client'
import { applyEloResult } from '@/lib/elo'

type Tx = PrismaClient | Prisma.TransactionClient

export async function applyTeamMatchResultToRatings(
  tx: Tx,
  seasonId: string,
  winnerTeamId: string,
  loserTeamId: string
): Promise<void> {
  const [winnerRating, loserRating] = await Promise.all([
    tx.teamRating.upsert({
      where: { seasonId_teamId: { seasonId, teamId: winnerTeamId } },
      create: { seasonId, teamId: winnerTeamId },
      update: {},
    }),
    tx.teamRating.upsert({
      where: { seasonId_teamId: { seasonId, teamId: loserTeamId } },
      create: { seasonId, teamId: loserTeamId },
      update: {},
    }),
  ])

  const winnerResult = applyEloResult(winnerRating.elo, loserRating.elo, 1, winnerRating.matchesPlayed)
  const loserResult = applyEloResult(loserRating.elo, winnerRating.elo, 0, loserRating.matchesPlayed)

  await Promise.all([
    tx.teamRating.update({
      where: { id: winnerRating.id },
      data: {
        elo: winnerResult.newElo,
        peakElo: Math.max(winnerRating.peakElo, winnerResult.newElo),
        matchesPlayed: { increment: 1 },
      },
    }),
    tx.teamRating.update({
      where: { id: loserRating.id },
      data: {
        elo: loserResult.newElo,
        peakElo: Math.max(loserRating.peakElo, loserResult.newElo),
        matchesPlayed: { increment: 1 },
      },
    }),
  ])
}
