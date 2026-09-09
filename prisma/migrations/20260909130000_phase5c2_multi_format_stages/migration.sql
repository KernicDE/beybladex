-- CreateEnum
CREATE TYPE "TournamentFormat" AS ENUM ('SINGLE_ELIMINATION', 'DOUBLE_ELIMINATION', 'SWISS');

-- CreateEnum
CREATE TYPE "StageStatus" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "BracketSide" AS ENUM ('WINNERS', 'LOSERS', 'GRAND_FINAL');

-- AlterTable
ALTER TABLE "Match" ADD COLUMN     "bracketSide" "BracketSide",
ADD COLUMN     "stageId" TEXT NOT NULL,
ADD COLUMN     "swissRound" INTEGER;

-- CreateTable
CREATE TABLE "TournamentStage" (
    "id" TEXT NOT NULL,
    "tournamentId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "format" "TournamentFormat" NOT NULL,
    "status" "StageStatus" NOT NULL DEFAULT 'PENDING',
    "swissRounds" INTEGER,
    "swissRoundsDone" INTEGER NOT NULL DEFAULT 0,
    "qualifyCount" INTEGER,
    "qualifiedUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "TournamentStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StageStanding" (
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "buchholz" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "opponentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "byes" INTEGER NOT NULL DEFAULT 0,
    "eliminated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "StageStanding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TournamentStage_tournamentId_order_key" ON "TournamentStage"("tournamentId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "StageStanding_stageId_userId_key" ON "StageStanding"("stageId", "userId");

-- CreateIndex
CREATE INDEX "Match_stageId_round_bracketOrder_idx" ON "Match"("stageId", "round", "bracketOrder");

-- AddForeignKey
ALTER TABLE "TournamentStage" ADD CONSTRAINT "TournamentStage_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageStanding" ADD CONSTRAINT "StageStanding_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "TournamentStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StageStanding" ADD CONSTRAINT "StageStanding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "TournamentStage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

