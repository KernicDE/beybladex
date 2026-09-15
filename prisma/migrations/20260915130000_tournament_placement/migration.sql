-- Issue #199 — persisted final placement per tournament participation. Additive/nullable, no
-- backfill: existing (already-completed) tournaments simply have no placement recorded until
-- explicitly recomputed — "bester Platz"/"durchschnittliche Platzierung" only ever reflects
-- tournaments completed from this point forward.

-- AlterTable
ALTER TABLE "TournamentParticipant" ADD COLUMN "placement" INTEGER;
