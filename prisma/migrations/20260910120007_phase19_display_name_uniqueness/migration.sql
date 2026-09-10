-- Phase 19 — Unique Display Names. Additive: User.displayNameNormalized, the collision-checked
-- form of displayName (trim().toLowerCase().normalize('NFKC'), computed in lib/displayName.ts at
-- every displayName write). Nullable — every existing row defaults to NULL, and Postgres unique
-- indexes permit multiple NULLs, so users who never set a display name never collide.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "displayNameNormalized" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_displayNameNormalized_key" ON "User"("displayNameNormalized");
