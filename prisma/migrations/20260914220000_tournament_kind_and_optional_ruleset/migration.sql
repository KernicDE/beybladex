-- Issue #176 — Event-Typen (Turnier/Stammtisch/Freeplay). Alle bestehenden Zeilen sind
-- klassische Turniere mit Bracket → Default 'BRACKET' deckt den Bestand korrekt ab, kein
-- Backfill nötig. rulesetId wird nullable (Stammtisch/Freeplay brauchen keines) — der FK bleibt
-- unverändert (ON DELETE RESTRICT ON UPDATE CASCADE gilt weiterhin, nur NOT NULL entfällt).

-- CreateEnum
CREATE TYPE "TournamentKind" AS ENUM ('BRACKET', 'STAMMTISCH', 'FREEPLAY');

-- AlterTable
ALTER TABLE "Tournament"
  ALTER COLUMN "rulesetId" DROP NOT NULL,
  ADD COLUMN "kind" "TournamentKind" NOT NULL DEFAULT 'BRACKET';
