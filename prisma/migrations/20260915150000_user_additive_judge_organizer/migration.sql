-- Issue #199 follow-up: Judge AND Organizer become ADDITIVE capabilities, independent of the
-- role trust ladder (which shrinks to GUEST/USER/TRUSTED/ADMIN). Backfill existing JUDGE/
-- ORGANIZER-role users into the new boolean flags, then downgrade their role to TRUSTED (the
-- tier immediately below, preserving their catalog-curation rights) since neither value is a
-- valid trust-tier value going forward. The Role enum keeps the JUDGE/ORGANIZER values
-- themselves (Postgres enums can't drop a value without a full type rebuild) — they must
-- simply never be written or checked by new code again.
ALTER TABLE "User" ADD COLUMN "isJudge" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "isOrganizer" BOOLEAN NOT NULL DEFAULT false;

UPDATE "User" SET "isJudge" = true WHERE "role" = 'JUDGE';
UPDATE "User" SET "isOrganizer" = true WHERE "role" = 'ORGANIZER';
UPDATE "User" SET "role" = 'TRUSTED' WHERE "role" IN ('JUDGE', 'ORGANIZER');
