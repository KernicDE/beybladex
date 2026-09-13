-- MVP4/4 (#144) — IA/UX-Umbau: Build.creatorId + Deck.visibility.
--
-- 1. Build.creatorId (nullable FK → User, ON DELETE SET NULL):
--    Öffentliche-Builds-Karten zeigen den Ersteller. Bestehende Rows haben keinen Creator
--    (NULL) — die Anzeige blendet den Ersteller dann schlicht aus. Account-Erasure
--    anonymisiert die User-Zeile in place (lib/accountErasure.ts), der Verweis bleibt also
--    bestehen und rendert "Gelöschter Nutzer" — kein Erasure-Eingriff nötig.
-- 2. Deck.visibility ("Visibility"-Enum, den es seit der MVP4-Split-Migration schon gibt —
--    kein CREATE TYPE nötig): PUBLIC (Default) = in öffentlichen Deck-Listungen sichtbar;
--    UNLISTED = nicht gelistet, aber niemals geheim (per Link/Turnier sichtbar). Default
--    PUBLIC hält die bestehende /decks/[username]-Listung regressionsfrei.

-- AlterTable
ALTER TABLE "Build" ADD COLUMN "creatorId" TEXT;

-- CreateIndex
CREATE INDEX "Build_creatorId_idx" ON "Build"("creatorId");

-- AddForeignKey
ALTER TABLE "Build" ADD CONSTRAINT "Build_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Deck" ADD COLUMN "visibility" "Visibility" NOT NULL DEFAULT 'PUBLIC';
