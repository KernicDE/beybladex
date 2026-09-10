-- Phase 16 — Dual-Spin Part Mode Support & Ruleset-Driven Deck Rules. All additive.

-- AlterTable: Part
ALTER TABLE "Part" ADD COLUMN "dualSpin" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: Match — spin-mode lock, nullable (only meaningful for dualSpin parts)
ALTER TABLE "Match" ADD COLUMN "player1SpinMode" "SpinDirection";
ALTER TABLE "Match" ADD COLUMN "player2SpinMode" "SpinDirection";

-- AlterTable: Tournament — "Turnier starten" one-way action, distinct from completedAt/startDate
ALTER TABLE "Tournament" ADD COLUMN "startedAt" TIMESTAMP(3);

-- AlterTable: TournamentParticipant — deck-build snapshot taken at startedAt
ALTER TABLE "TournamentParticipant" ADD COLUMN "lockedBuildIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
