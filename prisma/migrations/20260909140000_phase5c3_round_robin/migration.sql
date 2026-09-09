-- AlterEnum
ALTER TYPE "TournamentFormat" ADD VALUE 'ROUND_ROBIN';

-- AlterTable
ALTER TABLE "TournamentStage" ADD COLUMN     "roundRobinRepeats" INTEGER;

