-- Issue #181 — "Decklock": Tournament.deckLockAt (optionale Sperrfrist, null = Event-Start
-- gilt) und TournamentParticipant.deckReminderSentAt (Dedupe-Wächter für die 24h-Erinnerung).
-- Beide additiv/nullable — keine Backfill nötig, bestehende Zeilen bleiben unverändert.

-- AlterTable
ALTER TABLE "Tournament" ADD COLUMN "deckLockAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TournamentParticipant" ADD COLUMN "deckReminderSentAt" TIMESTAMP(3);
