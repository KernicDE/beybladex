-- RC7 (issue #36): missing indexes on hot per-user query paths. Pure CREATE INDEX — additive,
-- no table rewrites, no data loss. Hand-written (no local DB available); names follow Prisma's
-- `<Model>_<fields>_key` convention so future `prisma migrate diff` stays a no-op.

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TournamentParticipant_userId_idx" ON "TournamentParticipant"("userId");

-- CreateIndex
CREATE INDEX "CollectionItem_userId_idx" ON "CollectionItem"("userId");

-- CreateIndex
CREATE INDEX "Deck_userId_idx" ON "Deck"("userId");

-- CreateIndex
CREATE INDEX "Friendship_status_addresseeId_idx" ON "Friendship"("status", "addresseeId");

-- CreateIndex
CREATE INDEX "Tournament_clubId_startDate_idx" ON "Tournament"("clubId", "startDate");

-- CreateIndex
CREATE INDEX "Tournament_country_startDate_idx" ON "Tournament"("country", "startDate");
