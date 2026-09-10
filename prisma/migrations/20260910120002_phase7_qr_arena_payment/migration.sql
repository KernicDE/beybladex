-- Phase 7 — QR-Workflows & Zahlungsverfolgung: arena management (arenaCount + per-match
-- arenaNumber + QR check-in timestamps), the checkInToken credential, the TournamentJudge join,
-- and participant payment tracking (paidAt).

-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN     "arenaCount" INTEGER,
ADD COLUMN     "checkInToken" TEXT NOT NULL DEFAULT gen_random_uuid();

-- AlterTable
ALTER TABLE "TournamentParticipant" ADD COLUMN     "paidAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "arenaNumber" INTEGER,
ADD COLUMN     "player1ArenaCheckedInAt" TIMESTAMP(3),
ADD COLUMN     "player2ArenaCheckedInAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "TournamentJudge" (
    "tournamentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TournamentJudge_pkey" PRIMARY KEY ("tournamentId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tournament_checkInToken_key" ON "Tournament"("checkInToken");

-- AddForeignKey
ALTER TABLE "TournamentJudge" ADD CONSTRAINT "TournamentJudge_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentJudge" ADD CONSTRAINT "TournamentJudge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
