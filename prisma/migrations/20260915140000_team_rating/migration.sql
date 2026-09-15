-- Issue #199 — Team-Elo groundwork: TeamRating mirrors PlayerRating exactly, one row per
-- (season, team), created lazily on a team's first decided encounter (same upsert pattern as
-- lib/season.ts's applyMatchResultToRatings).

-- CreateTable
CREATE TABLE "TeamRating" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "elo" INTEGER NOT NULL DEFAULT 1000,
    "peakElo" INTEGER NOT NULL DEFAULT 1000,
    "matchesPlayed" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamRating_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TeamRating_seasonId_teamId_key" ON "TeamRating"("seasonId", "teamId");

-- CreateIndex
CREATE INDEX "TeamRating_seasonId_elo_idx" ON "TeamRating"("seasonId", "elo");

-- AddForeignKey
ALTER TABLE "TeamRating" ADD CONSTRAINT "TeamRating_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamRating" ADD CONSTRAINT "TeamRating_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
