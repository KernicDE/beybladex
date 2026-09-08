# Critical Review: BeybladeX Master Plan (Backend, Security, Privacy, Deployment)

**Plan reviewed:** `docs/superpowers/plans/2026-09-08-beybladex-master-plan.md` (1409 lines)
**Spec reviewed:** `BeybladeX.de - Master Projekt Spezifikation.md` (§3 Prisma schema, verbatim in plan Phase 1 Task 3)
**Date:** 2026-09-08
**Classification:** CRITICAL / IMPORTANT / NICE-TO-HAVE / UNDERSPECIFIED (UNDERSPECIFIED = an implementer would be blocked or forced to guess; distinct from merely suboptimal)

---

## Executive Summary

- **[CRITICAL] No database migration step exists anywhere in the deploy chain.** Phase 6 (`deploy.yml`, plan lines 1367–1394; acceptance criteria 1396–1400) builds and pushes an image and relies on Watchtower, but nothing ever runs `prisma migrate deploy`. Every schema change in Phases 2–5 ships code against an unmigrated database.
- **[CRITICAL] The production `compose.yml` cannot carry the environment variables later phases require.** Spec §4's compose is declared "authoritative and must not be altered in shape — only secrets substituted" (plan line 26), yet WebAuthn reads `WEBAUTHN_RP_ID ?? 'localhost'` (plan line 806) and the compose `environment:` list has no `WEBAUTHN_RP_ID` and no `${VAR}` interpolation — passkeys cannot work in production as constrained. The same wall blocks any future secret (TOTP encryption key, FX API key).
- **[CRITICAL] TOTP 2FA is never wired into the login flow.** `lib/auth.ts` credentials `authorize()` (plan lines 657–669) checks only username+password and returns a session; no staged second-factor step is described anywhere. `app/api/totp/verify/route.ts` only handles *setup* (plan line 864). As specified, enabling TOTP does not add any authentication factor.
- **[CRITICAL] No rate limiting on any endpoint.** Register, login, WebAuthn, TOTP — none mention throttling, despite Redis being available. TOTP (6-digit code, ~1M space) and credential stuffing are wide open.
- **[CRITICAL] `Build.bladeId/ratchetId/bitId` and `CollectionItem.partOrBeyId` are bare strings with no referential integrity**, and Phase 5's additive `Part` model (plan line 1324) never converts them into FK relations nor backfills — the integrity hole is permanent, not transitional.
- **[IMPORTANT] WebAuthn challenge storage is left as an unresolved "or"** (plan line 864: "post-login session **or** a short-lived Redis key keyed by a request nonce"), with no TTL, no single-use invalidation, and no binding story for the pre-login authentication ceremony (where no session exists by design).
- **[IMPORTANT] `Tournament` has no owner/organizer FK**, so Phase 3's "ORGANIZER/ADMIN only" check (plan line 1283) means *any* organizer can edit/delete *any* tournament; and no tournament edit/delete route is specified at all.
- **[IMPORTANT] Privacy enforcement is a post-fetch filter, not "query layer" enforcement as Global Constraints claim** (plan line 20); `resolveVisibleFields` (plan lines 927–955) omits `birthDate`/age and `bio`, which spec §2.D explicitly lists as privacy-controlled.
- **[IMPORTANT] One ioredis connection is specified for both commands and pub/sub** (plan lines 470–479) — a subscriber-mode connection cannot issue commands; the SSE notification design will break without a second connection. Pub/sub also has no missed-message replay for SSE clients.
- **[IMPORTANT] Acceptance criteria across Phases 2–6 test almost no authorization boundaries** — the only negative authz tests are ruleset PATCH 403 (line 1269) and club/friendship rules (lines 1312–1314). The judge score route, tournament POST role gate, collection privacy, and notifications ownership have no authz tests.

---

## 1. Data Model Soundness

References: spec §3 schema (copied verbatim in plan Task 3, lines 383–385); Phase 5 Part A (line 1324).

- **[CRITICAL] Referential-integrity hole in `Build` and `CollectionItem` is never closed.** Spec §3 models `Build.bladeId/ratchetId/bitId` and `CollectionItem.partOrBeyId` as bare `String` fields — no relation, no FK, no index. Phase 5 Part A (plan line 1324) adds a `Part` model "as an additive schema change" but the text only says to *add* the model plus seed data and a migration; it never says to convert `Build.bladeId` etc. into `@relation`s or to backfill existing rows. Consequence: parts can be deleted leaving orphaned builds, `validateNoDuplicateParts` (line 1328) must join through unindexed strings, and the Phase 5 migration task as written leaves the DB exactly as integrity-free as Phase 1. The task must explicitly include FK conversion (or document that the strings stay free-form forever, which contradicts "Build = 1 Blade + 1 Ratchet + 1 Bit", plan line 27).

- **[IMPORTANT] `Match.player1Id`, `player2Id`, `winnerId` are bare strings with no User relation.** Spec §3 `Match` (plan line 347–356 region): `judgeId` gets a proper `@relation("JudgeMatches")`, but `player1Id`/`player2Id`/`winnerId` dangle. No FK, no cascade, no index → unindexed joins for every bracket/leaderboard/stats query, and Phase 5's auto-meta win-rate engine (spec §2.E) builds on unverifiable references.

- **[IMPORTANT] No ownership FK on `Tournament`.** `Tournament` has `clubId` but no `createdById`/organizer relation. Phase 3 restricts `POST /api/tournaments` to ORGANIZER/ADMIN (plan line 1283), but with only a role check, any organizer can create — and, once an edit route exists, modify — tournaments they don't own. Ownership-based authz is impossible without a schema addition; none is planned.

- **[IMPORTANT] Missing `@@unique([tournamentId, userId])` on `TournamentParticipant`.** Duplicate registrations are only preventable by application code; double-click/retry race produces two participation rows, which then double-feed bracket generation (Phase 5, `generateSingleEliminationBracket`, line 1339). Compare `@@unique([clubId, userId])` and `@@unique([requesterId, addresseeId])`, which *are* in the schema and are explicitly tested (plan line 1315) — the participant constraint is the odd one out.

- **[IMPORTANT] `Rating` has no `userId`.** Spec §3 `Rating` = `{ id, buildId, stars, comment }` — fully anonymous. No per-user one-rating constraint, no abuse/spam attribution, no way to let users edit/delete their own rating, no privacy tie-in. Spec §2.A promises builds have "eigene Bewertungs-/Kommentarbereiche"; anonymous commenting on a community site will need moderation that this model cannot support. Additive change required (allowed per plan line 27, but not planned).

- **[IMPORTANT] Cascade/delete behavior is unspecified on most relations and the defaults are unexamined.** Prisma defaults: required relations without `onDelete` → `Restrict`; optional → `SetNull`. So deleting a `User` who owns a `Club` (`Club.owner`, spec §3) or created a `Ruleset` (`createdBy`) hard-fails; deleting a `Club` silently nulls `Tournament.clubId`; `TournamentParticipant.tournament/user`, `Deck.user`, `Rating.build`, `DeckBuild.build`, `Match.tournament` all Restrict. Some of these are probably intended (Restrict on ruleset-in-use is defensible), but the plan never reasons about them, and obvious ones like `Deck.user → Cascade` (a deleted account leaves undeletable decks) and `TournamentParticipant → Cascade` are left to the implementer's luck. Plan Task 3 copies the schema "verbatim" (line 385) and Global Constraints (line 27) demand deviations be "additive and documented" — delete behavior must be a deliberate, documented decision.

- **[IMPORTANT] `DeckBuild` composite PK `@@id([deckId, buildId, position])` permits the same `buildId` at two positions** in one deck. The "no duplicate parts" rule is enforced only in `lib/deckValidation.ts` (plan line 1328) — client-side plus server-side app code, but not at the DB layer, and Phase 5's acceptance test (line 1347) tests the API path only. Concurrent submissions can still race past the check. Either the PK should be `@@id([deckId, position])` or a unique index on `[deckId, buildId]` is needed.

- **[NICE-TO-HAVE] Missing query-pattern indexes** (beyond the FK indexes Prisma auto-creates for real relations): `Tournament.startDate` and `(country, state)` for calendar/RSS queries (Phase 3), `Notification(userId, createdAt)` for feeds (Phase 3), `(latitude, longitude)` on `User` and `Tournament` for `notifyUsersInRadius` (plan line 1288) — at DACH scale sequential scans are tolerable, but the radius query is the notification hot path.

- **[NICE-TO-HAVE] `Match` has no round/bracket-position/state fields.** Phase 5's `generateSingleEliminationBracket` (line 1339) and judge flow will need `round`, `bracketOrder`, `status`/`playedAt` — none exist. Additive changes are allowed but not pre-planned; expect schema churn mid-phase.

- **[UNDERSPECIFIED] How `Phase 1 Task 3`'s integration test (plan lines 403–416) should run against migrations in CI.** The test requires a live Postgres; `ci.yml` (plan line 1363) runs `npm test` on every PR but no CI Postgres/Redis service container is specified. Either the integration suite needs dockerized services in CI or the tests silently don't run there.

---

## 2. Auth & Security

References: plan Task 5 (lines 549–696), Task 6 (lines 700–871), Phase 1 DoD (lines 1240–1249).

- **[CRITICAL] TOTP 2FA is not wired into authentication at all.** `lib/auth.ts` (plan lines 649–671) uses NextAuth credentials with `authorize()` returning a full session after password check only. The plan's TOTP pieces are: `generateTotpSecret`/`verifyTotp` helpers (lines 749–761), a setup route returning a QR code, and a verify route that "on success, sets `user.totpSecret`" (line 864) — i.e., *enrollment* only. There is no described login-time step where `user.totpSecret != null` forces a second factor before a session is minted (no staged flow, no NextAuth callback, no `twoFactorRequired` interim token). As written, "TOTP 2FA" ships as a QR-code generator that doesn't gate anything. Phase 1 DoD line 1245 ("TOTP setup produces a scannable QR and verifies") only proves enrollment, not enforcement — the acceptance test would pass with 2FA fully bypassed.

- **[CRITICAL] No rate limiting / brute-force protection on any endpoint.** Register (line 618), `/api/auth/*` (line 677), WebAuthn (line 864), TOTP verify (line 864): none mention throttling. A 6-digit TOTP code has ~10⁶ space and `verifyTotp` (lines 755–761) does not implement otplib's `window`/attempt limits beyond defaults — unlimited online guesses. Redis is already a dependency and would be the natural limiter store; its absence is an omission, not a decision. Username enumeration is also unmitigated: register returns distinct 409 vs 201 (line 629) and login timing differs for unknown-user vs wrong-password (bcrypt skipped when `passwordHash` missing, line 664) — acceptable trade-offs, but only if throttled.

- **[CRITICAL] `WEBAUTHN_RP_ID` cannot reach production.** `lib/webauthn.ts` (plan line 806) defaults `rpID` to `'localhost'`; production needs `beybladex.de`. But Global Constraints (plan line 26) make spec §4's `compose.yml` "authoritative and must not be altered in shape (only secrets substituted)", and spec §4's `environment:` list contains no `WEBAUTHN_RP_ID` and uses no `${VAR}` interpolation — there is no mechanism to inject the variable. Either the constraint bends (compose gains one env line, contradicting the plan) or passkeys break in prod. Every future env-dependent feature (TOTP encryption key, FX API credentials — Phase 5, line 1334) hits the same wall. The "don't alter compose" rule and the env-driven config design are mutually incompatible as specified.

- **[IMPORTANT] `User.totpSecret` is stored plaintext (spec §3 line 168).** A database dump hands an attacker every user's 2FA seed — precisely the secret 2FA exists to protect. Encrypt at rest (AES-GCM with a server-side key from env) and decrypt only in `verifyTotp`. Also note: since login-time TOTP isn't implemented (above), the plaintext field currently stores a secret that adds zero security while adding breach risk.

- **[IMPORTANT] WebAuthn challenge storage is an unresolved fork with no security properties attached.** Task 6 Step 10 (plan line 864): "storing the WebAuthn challenge in the (post-login) session **or** a short-lived Redis key keyed by a request nonce — never in a guest cookie." Problems: (a) for the *authentication* ceremony there is no post-login session by design (cookieless guests, plan line 16), so the session option doesn't even apply to passkey login — only the Redis path is viable, and the plan doesn't commit to it; (b) "short-lived" has no TTL value; (c) single-use invalidation after verify is not stated (challenge reuse is a real WebAuthn attack class); (d) nothing binds the nonce to the client that started the ceremony, so a challenge minted for one client can be answered from another; (e) passkey *login* has no described session-creation path at all — after `verifyAuthentication` returns true (plan lines 839–854), who calls NextAuth `signIn` to mint the JWT? The two libs are not connected.

- **[IMPORTANT] JWT sessions cannot be revoked; no token-version field.** `session: { strategy: 'jwt' }` (plan line 650) with no `maxAge`/`updateAge` specified and no `tokenVersion` on `User`. Password change, TOTP enrollment, or an admin banning a compromised JUDGE/ADMIN account cannot invalidate existing tokens before expiry — dangerous given judge scoring and organizer powers in later phases. At minimum document the expiry decision; better: add a `tokenVersion` check in the `jwt` callback (requires schema field — additive).

- **[IMPORTANT] Username handling invites impersonation and route breakage.** Register validation (plan lines 621–623) enforces only length ≥ 3. No charset rule, no case normalization: `Alice` and `alice` are distinct users (Postgres unique is case-sensitive), and a username containing `/`, spaces, or unicode breaks `/profile/[username]` routing and confuses @-mentions. No reserved-word list (e.g. `admin`, `api`). Email, when given, is stored with no format validation (line 633).

- **[NICE-TO-HAVE] Password policy is length-only (≥8)** with no max-length bound on `req.json()`/bcrypt input, no breach-list screening. Also no login CSRF concern (NextAuth handles its own; `SameSite=Strict` set at line 653 — good), and `secure` correctly keyed to production (line 653).

- **[NICE-TO-HAVE] Session fixation:** with cookieless guests and NextAuth setting a fresh session token on `signIn` success, the classic fixation vector is largely closed (plan line 680's note is accurate). Worth an explicit assertion in the register test (line 578) that no `Set-Cookie` appears on any pre-login response — currently only checked manually in DoD (line 1244).

---

## 3. Privacy Enforcement

References: plan Task 7 (lines 875–972), Global Constraints line 20, Cross-Phase Regression Guard lines 1404–1409, Phase 5 Part B (line 1333).

- **[IMPORTANT] The mechanism contradicts its own stated guarantee.** Global Constraints (plan line 20): "enforced at the query layer, not just the UI." `resolveVisibleFields` (lines 927–955) fetches the full user row and then nulls fields post-hoc. The data *is* retrieved from the DB unrestricted on every call — any later page that renders `subject.city` directly (or returns the raw row from an API route) leaks silently. It is a rendering-time whitelist, not query-layer enforcement. Either reword the constraint (post-fetch projection) or add a query-layer variant (Prisma `select` built from the same visibility map) so the sensitive columns are never fetched for unauthorized viewers. The latter matters for `birthDate` and location data under DACH privacy expectations.

- **[IMPORTANT] `birthDate`/age and `bio` are ungated, though spec §2.D lists "Alter" as privacy-controlled.** Schema §3 has only four visibility fields (`profileVisibility`, `locationVisibility`, `collectionVisibility`, `decksVisibility`) — none covers age — and `resolveVisibleFields` doesn't handle `birthDate` or `bio` at all (lines 943–954 map only displayName, discordTag, city, collection, decks). Result: a privacy feature that *cannot* implement the spec's own field list. Either the spec's field list shrinks or the schema needs an `ageVisibility` (additive, must be planned into Phase 1 Task 7 while the privacy module is born, not retrofitted).

- **[IMPORTANT] Friendship-lookup cost and consistency are pushed to every consumer.** `resolveVisibleFields(subject, viewerId, isFriend)` takes `isFriend` as a parameter — each call site must run its own `prisma.friendship` lookup (Task 7 Step 5, line 965, does this for the profile page). Phase 4's acceptance criterion (line 1313) says "wire the friendship lookup into the privacy gate" — singular page. But the guard (line 1409) demands the gate on club rosters, collection pages, deck listings — an N+1 pattern (30-member club roster = 30 friendship queries) with no specified batch helper (`areFriends(viewerId, userIds[])`). Define one shared helper in Phase 4 or every consumer will improvise — and some will forget the BLOCKED-status check, since "isFriend" semantics (PENDING vs ACCEPTED vs BLOCKED) are never formally defined.

- **[IMPORTANT] Tournament/match surfaces bypass deck privacy by construction.** Matches in public tournaments carry `player1BuildId`/`player2BuildId`; brackets (Phase 5 Part C, line 1338) render those builds. If a player's `decksVisibility` is PRIVATE, their deck still appears in every public bracket they play in. The plan never addresses this interaction. It may be acceptable (tournament play is public) — but it must be an explicit decision, ideally surfaced in UI ("your deck is visible in tournaments you enter"), otherwise the privacy setting lies.

- **[IMPORTANT] Notifications endpoints lack specified authz.** `app/api/notifications/route.ts` (line 1287: GET list, PATCH mark-read) and `/api/notifications/stream` (line 1289, SSE) have no stated ownership rule: can user A read/mark-read user B's notifications by passing an `id`? Can A subscribe to B's SSE channel? The acceptance criteria (lines 1292–1296) don't test it. Given notifications contain event/location data, this needs an explicit "notifications are scoped to the authenticated session user only" criterion and negative test.

- **[UNDERSPECIFIED] Semantics of the collection privacy gate.** Phase 5 Part B (line 1333): `app/api/collection/route.ts` "respects `collectionVisibility` via `resolveVisibleFields` when viewing another user's." What does "respects" mean — 403, 404, or 200-with-empty? (Plan Phase 2 line 1268 sensibly mandates 404-not-403 for rulesets; no equivalent decision here.) And `resolveVisibleFields` returns a `collectionVisible` boolean while the route must actually filter rows — the mapping from boolean to HTTP behavior is undefined.

---

## 4. API / Route Design

References: Phase 2 (lines 1252–1272), Phase 3 (lines 1275–1296), Phase 4 (lines 1300–1315), Phase 5 (lines 1319–1350).

- **[IMPORTANT] Authorization is tested almost nowhere.** Inventory of negative authz tests in the acceptance criteria: ruleset PATCH 403 (line 1269 — good, and correctly 404-not-403 for unpublished rulesets, line 1268), friendship transition table (line 1312), club promote/demote 403 (line 1314), unique-constraint rejection (line 1315). Everything else is happy-path: tournament POST role gate (line 1283) is stated in the Files list but appears in **no acceptance test**; `app/api/matches/[id]/score/route.ts` (line 1343) — the route that mutates competitive results — has **no stated authz at all** (who may post a score: any logged-in user? the assigned judge? any JUDGE-role user?); collection privacy (line 1333) and profile privacy PATCH (line 965, "owner-only" without a test) likewise. The plan's own structure (phases write their own sub-plans) means this could be fixed there — but the master plan should require "every route lists its authz rule and every authz rule has a negative test" as a standing acceptance item, the way the zero-CDN guard is standing (lines 1406–1408).

- **[IMPORTANT] No tournament edit/delete route exists.** Phase 3's file list has only `app/api/tournaments/route.ts` (GET/POST, line 1283). Cancelling an event, fixing a wrong address, closing registration — none have a route. Combined with the missing owner FK (Section 1), tournament lifecycle management is unspecified where it matters most.

- **[IMPORTANT] Score route has no idempotency story for offline sync.** Phase 5 Part C (lines 1341–1343): `enqueueScore`/`flushQueue` POST queued scores on reconnect; `background sync` can retry; a flaky connection can double-flush. The score route (line 1343) computes points server-side from posted events — a replayed POST applies points twice unless the route is idempotent (idempotency key per queued item, or event-sourced dedup). The Playwright offline test (line 1344, `setOffline(true/false)`) verifies eventual delivery, not exactly-once. For a competition platform, double-scored matches are a CRITICAL-adjacent correctness bug; at minimum IMPORTANT to specify.

- **[IMPORTANT] Judge scoring authz chain is undefined end-to-end.** Phase 5 says matches are scored via `/api/matches/[id]/score`, offline, from a PWA. If the device is offline, the queued POST fires on reconnect with the judge's session cookie — fine. But the route must verify the caller is the match's assigned judge (or a tournament official), and the *offline* client must not be able to queue scores for arbitrary match IDs. No criterion covers this; plan line 1343 only describes point math.

- **[NICE-TO-HAVE] Route surface is otherwise reasonable and RESTful** (slug-based public reads, JSON APIs for mutations, RSS as route handlers). Two nits: the tile proxy test (line 490) requests `/api/map/tile/1/1/1` while the interface contract says `{y}.png` (line 461) — harmless but the canonical form should be pinned; and `z/x/y` are unvalidated beyond `replace(/\.png$/)` (line 514) — negative or absurd coordinates just proxy 4xx from upstream, but a per-IP rate limit on the tile proxy would also be polite to OSM's tile usage policy (currently: none, and the proxy is an open fetch-amplifier).

- **[NICE-TO-HAVE] No consistent error-shape or validation library specified.** Each route hand-rolls checks (e.g., lines 621–626); error codes are ad-hoc strings (`invalid_username`, `username_taken`). Fine at this scale, but decide once in Phase 1 (`lib/api.ts` with a typed error envelope) rather than letting five phases diverge.

- **[UNDERSPECIFIED] What `PATCH` accept/block on `app/api/friends/[id]/route.ts` (line 1305) operates on** — friendship row `id` presumably, but the endpoint contract (body shape, which side may call which transition, what a re-request after BLOCKED returns — 409? 403? — acceptance line 1312 only says "can't be re-requested") is not written down.

---

## 5. Redis Usage

References: plan Task 4 (lines 452–545), Phase 3 (lines 1288–1289), Phase 5 Part B (line 1334), `lib/redis.ts` (lines 470–479).

- **[IMPORTANT] Single Redis connection specified for commands **and** pub/sub.** `lib/redis.ts` (lines 470–479) exports one ioredis singleton, and the repo-wide description (line 76) assigns it "pub/sub, SSE, leaderboards". An ioredis connection that has issued `SUBSCRIBE` enters subscriber mode and rejects regular commands (`Connection is in subscriber mode`). The SSE endpoint (line 1289) needs a dedicated subscriber connection; `lib/notify.ts` (line 1288) publishes on another. The plan must create two connections (e.g. `redis` + `redisSubscriber`) or Phase 3's first `subscribe` call breaks every other Redis user (tile cache, rate limiting, currency cache).

- **[IMPORTANT] Pub/sub delivery has no missed-message story.** `notifyUsersInRadius` (line 1288) writes durable `Notification` rows (good) *and* publishes for live SSE delivery. Redis pub/sub is fire-and-forget: a client that is disconnected (or whose SSE stream drops — mobile judges on venue Wi-Fi, the exact population this app serves) at publish time never receives the live event. The SSE endpoint has no `Last-Event-ID`/replay logic to backfill unread rows on reconnect, and no acceptance criterion covers "notification created while client offline appears in the stream/list after reconnect." Decide: SSE is a nicety on top of the durable list (client refetches on reconnect — then say so), or implement replay.

- **[IMPORTANT] Redis in compose has no memory bound; tile cache is unbounded.** Spec §4 redis service (no `maxmemory`, no eviction policy, `noeviction` default) + tile cache 14-day TTL on every `{z}:{x}:{y}` (line 509) = slow OOM. DACH-wide map browsing at zoom 15–17 generates millions of tiles. Set `maxmemory` + `allkeys-lru` (tiles are perfect LRU candidates; pub/sub and rate limits tolerate eviction) and consider a max zoom cap. Also no cache-stampede protection: a hot tile expiring fans out N simultaneous upstream fetches — a short per-key lock (SET NX PX) is a one-liner with the Redis already present.

- **[UNDERSPECIFIED] Currency-rate fetch schedule has no host.** `lib/currency.ts` (line 1334): "rates fetched server-side on a schedule and cached in Redis." There is no scheduler in this architecture — single Next.js container, no worker process, no cron service in compose (which cannot be altered). Options all unstated: fetch-on-miss with stale-while-revalidate, a `setInterval` in the Node process, or an external cron hitting an internal route. Also unstated: the source API, the TTL, and the stale-fallback behavior when the FX source is down (serve last cached rate? fail conversion?).

- **[NICE-TO-HAVE] Race on concurrent rate refresh** — two instances (or two requests on miss) fetch FX simultaneously; add a short SET-NX lock or accept duplicate fetches. Low impact at DACH scale.

- **[NICE-TO-HAVE] Intro-level promises not mapped to phases.** The architecture blurb (line 7) advertises Redis for "leaderboard caching," but no phase implements a leaderboard cache (auto-meta is Phase 5 scope, line 1324 region, with no caching story). Either drop the promise or add it to Phase 5's file list — otherwise a later phase will "remember" it and bolt it on ad hoc.

- **[NICE-TO-HAVE] `redis.getBuffer` + `redis.set(key, Buffer)` (lines 517–529)** is fine, but the cached response lacks cache-busting/versioning — when the tile *URL format* changes, old binary values under the same key space persist for 14 days. Prefix keys with a format version (`osm-tile:v1:...`).

---

## 6. Deployment

References: plan Phase 6 (lines 1354–1400), Global Constraints line 26, spec §4 compose.

- **[CRITICAL] Nothing runs database migrations.** Phase 6's concrete `deploy.yml` (lines 1367–1394) does checkout → buildx → login → push, full stop. Watchtower then pulls `:latest` and restarts the app container. Nowhere — not in the workflow, not in the Dockerfile, not in compose (which can't be altered), not in a server-side step — does `prisma migrate deploy` run. Consequences: (a) the initial deployment has an empty database with no migration history applied; (b) every Phase 2–5 schema change ships code expecting columns that don't exist → 500s across the site until someone manually execs into the container. Fix options: a workflow job that SSHes to the server to run `docker compose exec app npx prisma migrate deploy` after push (requires SSH secrets — none are in the workflow), an entrypoint script in the image that runs migrations before `next start` (simplest, keeps compose untouched), or Watchtower run-pre-update hooks. The plan must pick one; today it picks none.

- **[CRITICAL] Secrets handling contradicts the unmodifiable-compose constraint.** Plan line 1362: compose.yml "verbatim from spec §4, secrets substituted via `.env` on the server, never committed." But spec §4's compose uses literal values in an `environment:` list (`DATABASE_URL=postgresql://...SECRET_DB_PASSWORD...`, `NEXTAUTH_SECRET=SECRET_NEXTAUTH_TOKEN_CHANGE_ME`) with **no `${VAR}` interpolation and no `env_file:`** — docker-compose does not read `.env` into `environment:` lists written this way; `.env` only substitutes `${}` references. So as constrained, the literal string `SECRET_NEXTAUTH_TOKEN_CHANGE_ME` becomes the production auth secret, and the only way to fix it is to alter compose's shape — which line 26 forbids and line 1362 simultaneously requires. Resolution demands either `${VAR}` interpolation (a shape change) or `env_file:` (a shape change): the constraint itself must be amended. Also: `NEXTAUTH_SECRET` being a guessable placeholder in a *committed* file is a footgun even pre-launch.

- **[IMPORTANT] Migration ordering vs. zero-downtime is unaddressed and unaddressable in the current shape.** Even once migrations run, the chain is: Watchtower sees new image → stops `beybladex_app` → starts new container. There is exactly one app container (`container_name: beybladex_app`, spec §4) — every deploy is a hard stop/start with a downtime window, and there is no expand/contract migration discipline stated (new code must tolerate old schema during the window, or migrations must be backward-compatible). At minimum the plan should state: migrations must be additive/backward-compatible with the previously deployed image, because old and new code are never running simultaneously by design — a deploy is a big-bang switchover. A healthcheck on the app service would at least keep Traefik from routing to a half-booted Next.js (none specified).

- **[IMPORTANT] Watchtower's own existence is assumed, not specified.** The compose gives the app the `com.centurylinklabs.watchtower.enable=true` label (spec §4), but nothing in Phase 6 verifies that a Watchtower daemon is actually running on `nicolas@kernic.net` (it isn't in this compose; it must live in the separate Traefik stack), nor its poll interval, nor `WATCHTOWER_CLEANUP` (without it, every deploy leaks a dangling image on the server until the disk fills). Add a deployment acceptance step: confirm Watchtower logs show the pull and that old images are pruned.

- **[IMPORTANT] `next.config.ts` is never given `output: 'standalone'`.** Phase 6 (line 1359) mandates a Dockerfile using "Next.js `output: 'standalone'`", but `next.config.ts` is created in Phase 1 Task 1 without that setting and Phase 6's Files list (lines 1358–1363) doesn't include modifying it. An executor following the file list literally produces a Dockerfile that copies `.next/standalone` — which was never generated. One-line fix; one-line omission.

- **[NICE-TO-HAVE] No rollback strategy.** A bad image auto-deploys to production with no canary and no "re-push previous tag." Mitigation is manual (`ssh` + `docker compose up -d` with a pinned tag) — write it into Phase 6's runbook-style acceptance criteria.

- **[NICE-TO-HAVE] No database backup.** Postgres volume `postgres_data` has no dump/backup job (spec §4 includes none and compose can't change). For a platform holding user accounts, friendships, and tournament results, a nightly `pg_dump` cron on the host should be part of Phase 6's operational acceptance.

- **[NICE-TO-HAVE] `deploy.yml` uses `GITHUB_TOKEN` with `packages: write` (lines 1376–1386)** — correct and least-privilege; good. Tagging only `:latest` (line 1391) loses immutable release tags, which would also enable rollback-by-tag.

- **[UNDERSPECIFIED] Where integration/e2e tests get their Postgres and Redis in `ci.yml`.** Line 1363 promises `npm test` + Playwright gate every PR, but the integration suite (Task 3 line 403, Task 4 line 483) needs live Postgres/Redis and Playwright needs a running app + DB. No CI service containers, no test-database env wiring, no Playwright webServer config are specified — as written, CI either fails or silently skips the integration tests it was created to enforce.

---

## Prioritized Punch List

### CRITICAL — fix before implementation starts

1. **Add a migration mechanism to the deploy chain** (§6): entrypoint `prisma migrate deploy` before `next start`, or an explicit post-push SSH step in `deploy.yml`. Plan Phase 6, lines 1354–1400.
2. **Resolve the compose-secrets contradiction** (§6, §2): spec §4 compose as written cannot accept `.env` substitution; amend the "must not be altered in shape" constraint to allow `env_file:` or `${VAR}` interpolation, and ensure `NEXTAUTH_SECRET`, DB password, and `WEBAUTHN_RP_ID` are injectable. Plan lines 26, 1362.
3. **Wire TOTP into the actual login flow** (§2): staged second-factor between password verification and session minting; acceptance test must prove a password-only login fails when `totpSecret` is set. Plan Task 5/6, lines 649–671, 864; DoD line 1245.
4. **Specify rate limiting** (§2) on `/api/register`, `/api/auth/*`, `/api/webauthn/*`, `/api/totp/*` using Redis (also fixes the single-connection issue by defining the Redis client topology). Plan Tasks 5–6.
5. **Decide and document the `Build`/`CollectionItem` → `Part` referential-integrity plan** (§1): Phase 5 line 1324 must either convert `bladeId/ratchetId/bitId/partOrBeyId` to real FK relations with a backfill migration, or the plan must explicitly accept permanent string references and say so. Silent drift is the worst outcome.
6. **Commit to the WebAuthn challenge design** (§2): Redis-only (session option is impossible for the login ceremony), with TTL, single-use invalidation, client binding, and the post-verify session-minting path. Plan Task 6 Step 10, line 864.

### IMPORTANT — fix before the relevant phase starts

7. Phase 1: encrypt `User.totpSecret` at rest; add token-revocation story (tokenVersion or short session TTL). (§2)
8. Phase 1: username charset/case normalization + reserved names. (§2)
9. Phase 1: fix the privacy module — decide query-layer vs post-fetch honestly, add age/`bio` handling or amend spec field list, define `isFriend` semantics (ACCEPTED only, BLOCKED handling). (§3)
10. Phase 3: two Redis connections (commander + subscriber); missed-notification replay or explicit reconnect-refetch policy; notifications endpoint authz + tests. (§5, §3)
11. Phase 3: add `Tournament.createdById` (or equivalent ownership) to the schema additively; add tournament edit/delete routes with owner authz; add the missing acceptance tests for the POST role gate. (§1, §4)
12. Phase 3/6: Redis `maxmemory` + eviction policy (requires the compose amendment from #2); tile-cache stampede lock and versioned keys. (§5)
13. Phase 4: batch friendship-lookup helper; negative authz tests for privacy-gated routes (collection, profile PATCH). (§3, §4)
14. Phase 5: `@@unique([tournamentId, userId])`; `Rating.userId`; score-route idempotency for offline sync; judge-score authz; deck-privacy-vs-public-bracket decision. (§1, §4)
15. Phase 5: currency-rate scheduler host + stale-fallback policy. (§5)
16. Phase 6: `output: 'standalone'` in `next.config.ts`; CI Postgres/Redis/Playwright wiring; Watchtower presence/cleanup verification; deploy downtime + backward-compatible-migration policy stated. (§6)
17. Cross-phase: standing acceptance rule — every route declares its authz rule and every authz rule has a negative test (mirror the zero-CDN guard, lines 1406–1408). (§4)
18. Schema: deliberate, documented onDelete matrix (at minimum `Deck.user`, `TournamentParticipant`, `Club.owner`, `Ruleset.createdBy` decisions). (§1)

### NICE-TO-HAVE

19. Consistent API error envelope + shared validation helper in Phase 1. (§4)
20. Password policy hardening (max length, breach list); tile-proxy per-IP politeness limit. (§2, §4)
21. Leaderboard caching promise either scoped to Phase 5 or dropped from the architecture blurb. (§5)
22. App healthcheck for Traefik; immutable version tags + rollback runbook; nightly `pg_dump`. (§6)
23. Query-pattern indexes (`Tournament.startDate`, `Notification(userId, createdAt)`, lat/lng). (§1)
