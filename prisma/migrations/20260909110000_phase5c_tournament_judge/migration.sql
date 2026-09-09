-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED');

-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "completedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TournamentParticipant" ADD COLUMN     "withdrawn" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "bracketOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "clientEventId" TEXT,
ADD COLUMN     "round" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" "MatchStatus" NOT NULL DEFAULT 'PENDING',
ALTER COLUMN "player1Id" DROP NOT NULL,
ALTER COLUMN "player2Id" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Match_clientEventId_key" ON "Match"("clientEventId");

-- CreateIndex
CREATE INDEX "Match_tournamentId_round_bracketOrder_idx" ON "Match"("tournamentId", "round", "bracketOrder");

