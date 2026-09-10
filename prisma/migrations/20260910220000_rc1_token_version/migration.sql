-- RC1 Security Hardening (issue #50) — session revocation. Additive: User.tokenVersion (Int,
-- default 0). Bumped on GDPR erasure (lib/accountErasure.ts) and TOTP deactivation
-- (app/api/totp/disable/route.ts); stamped into every JWT as the `tv` claim and re-checked in
-- lib/auth.ts's jwt callback on every request, so a pre-bump 30-day token stops authenticating
-- immediately. Existing rows default to 0, matching the tv=0 their already-issued tokens
-- implicitly carry (tokens issued before this change have no tv claim at all — the jwt callback
-- treats a missing claim as "grandfathered", see lib/auth.ts).

-- AlterTable
ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
