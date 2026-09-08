# Review: BeybladeX.de Master Plan — Maximal-Performance Angle

**Plan reviewed:** `docs/superpowers/plans/2026-09-08-beybladex-master-plan.md` (1910 lines)
**Spec reviewed:** `~/Downloads/BeybladeX.de - Master Projekt Spezifikation.md`
**Prior reviews:** `review-backend-security.md`, `review-frontend-pwa.md` — all findings below are checked against those two documents; overlaps are only included where this review adds a *new performance dimension* (and are marked as such).
**Date:** 2026-09-08
**Classification:** CRITICAL / IMPORTANT / NICE-TO-HAVE, plus an explicit "verified fine" list — the question answered here is "is a shortcut costing real performance," not "could a hyperscale rewrite be faster."

---

## Executive Summary

**There are no Critical performance findings.** For the workload described — a single-team DACH community platform, realistically hundreds of concurrent users at peak, one app container, one Postgres, one Redis — the Next.js + Prisma + PostgreSQL + Redis architecture is appropriately sized, and most of the hot-path decisions in the plan (Redis tile cache with per-instance single-flight, full-state idempotent score payloads, JWT sessions, standalone Docker output, buildx layer caching in CI) are genuinely the performance-correct ones, not framework shortcuts. Where the plan was previously wrong (tile stampede, SW asset caching), the earlier reviews already forced the fix, and the fixes are the performant ones too.

The findings that matter, in priority order:

1. **[IMPORTANT] No pagination is specified anywhere** — notifications (a forever-growing per-user table), collections, friends lists, club rosters, and deck lists would all load unbounded. At DACH scale this takes years to hurt, but a 5-year-old account's notification list loading in one query is a real user-visible regression the plan should close now, while the routes are being designed.
2. **[IMPORTANT] `rateLimit()` is two non-atomic round trips (INCR + conditional EXPIRE)** — halves to one with a Lua script and closes a small race where a key can persist without a TTL and permanently lock out a route. Latency impact is negligible (bcrypt dominates the login path by 100×); the atomicity is the point.
3. **[IMPORTANT] The platform has no image story at all** — neither spec §3 nor the plan has an image/avatar field on `Part`, `Build`, `CollectionItem`, or `User`, and nothing specifies `next/image` or any sizing/optimization. This is a product gap *and* a performance trap: the day part images or avatars get bolted on ad hoc, multi-MB `<img>` tags on mobile collection pages will be the single worst performance regression this site can produce. Decide the mechanism before Phase 5.
4. **[IMPORTANT] Read-heavy public pages (rulesets, events, RSS) have no caching directive** — under Next.js 15 defaults these hit Postgres fresh on every request. Trivially fixed with `export const revalidate` / route-segment config; the bracket/judge/notifications surfaces should correctly stay dynamic.
5. **[NICE-TO-HAVE]** profile-page query pairing, `SELECT` scoping as a hardening step, pipelining bulk Redis publishes, batched judge queue flush, Node version hygiene in the Dockerfile.

And the honest "this is fine" verdicts the brief asked for: the OSM tile proxy in Next.js+Redis is fast enough for DACH map traffic and extracting it to Go/nginx buys ~1–2ms/tile that nobody will feel; SSE in a single Node container supports thousands of idle connections, far above this site's ceiling, and REST+offline-queue (not WebSockets) is the *performance-correct* choice for judge scoring precisely because of the offline-first constraint. Details below.

---

## 1. Next.js App Router Usage Patterns

### Verified fine — client/server boundary is drawn correctly

- **Task 10 `Header` is a server component receiving `session` as a prop** (plan ~line 1604) — the right pattern. `auth()` runs in the server layout, the session object crosses the boundary as serialized props, and only `ThemeToggle` pays client-component cost. This is exactly the boundary the question asks about; the plan draws it well.
- **Task 2 `ThemeProvider` wraps children but does not convert them to client components** — children passed through a client component's `children` slot stay server-rendered. The root-layout provider costs a small, constant JS payload on every page (context + hook), which is the unavoidable price of a runtime toggle; there is no cheaper correct design. Fine.
- **Register/login pages as client-component forms** (Task 5 Step 7) — they inherently need interactivity; fine, and they're isolated routes so the cost doesn't leak elsewhere.
- **Leaflet, judge pad, deck builder live only on their routes** — no shared-component contamination of the root layout (nothing map- or judge-related is mounted in `app/layout.tsx`). Good.
- **JWT (stateless) sessions** mean `auth()` in server components is a local HMAC verify, not a DB round trip per request. Correct choice for this scale.

### P1 — Profile page: three sequential awaits where two can be one — NICE-TO-HAVE

**Reference:** Task 7 Step 5 (~line 1299): "loads `auth()` session for `viewerId`, loads friendship status via a `prisma.friendship` lookup, calls `resolveVisibleFields`."

`resolveVisibleFields` itself is synchronous (in-memory projection), so the chain is: `auth()` → `prisma.friendship.findFirst` → `prisma.user.findUnique`. The user fetch and the friendship lookup both depend only on the URL param and the session, so they can run under one `Promise.all` after `auth()`:

```ts
const [subject, friendship] = await Promise.all([
  prisma.user.findUnique({ where: { username } }),
  prisma.friendship.findFirst({ where: { /* OR(requester/addressee) */ } }),
])
```

Honest calibration: this saves one ~1–2ms round trip on a page that also does RSC serialization, auth, and rendering. **Classify NICE-TO-HAVE** — specify the `Promise.all` shape in the Phase 4 sub-plan when the friendship lookup is wired in, purely so the pattern is established once and copied, not because 2ms is measurable.

### P2 — No data waterfalls exist elsewhere — verified

The other server-component data paths in the plan are either single queries (ruleset view, collection GET, tournament GET), joins through Prisma relations (bracket: tournament → matches → participants, one `include` tree), or deliberately sequential by data dependency (score POST must read match → ruleset before writing — not parallelizable, and shouldn't be). No nested-Server-Component sequential-await chain is sketched anywhere. The one structural N+1 risk (per-member friendship lookups on club rosters, 30 members = 30 queries) was already flagged in `review-backend-security.md` (Important #13, batch `areFriends(viewerId, userIds[])` helper) — **this review endorses that fix as-is; from the performance side it is the same fix and needs no addition.** Only note: when Phase 4 writes the batch helper, implement it as a single `findMany({ where: { OR: [...], status: 'ACCEPTED' } })` returning a `Set<userId>`, not per-user queries.

---

## 2. Prisma Query Efficiency

### P3 — No pagination specified for any list — IMPORTANT

**Reference:** Phase 3 `app/api/notifications/route.ts` ("GET list", ~line 1755); Phase 5 Part B `app/api/collection/route.ts` (~line 1805); Phase 4 friends list (~line 1777); `app/clubs/[slug]/page.tsx` roster (~line 1779); `app/rules/page.tsx` list; `app/decks/page.tsx`.

Every list endpoint/page in the plan is specified without any `take`/limit, cursor, or offset. Consequences as the site ages:

- **Notifications is the worst case** — an append-only per-user table. A user active for 3 years accumulates thousands of rows; the SSE-replay-on-connect path (Phase 3, ~line 1758) also reads "rows created after last-seen" with no bound. One unbounded query per page load, forever growing.
- Collection items and friends lists grow linearly with user activity; club rosters are naturally bounded (fine).

**What to change:** add a standing acceptance item to the Cross-Phase Regression Guard: *every list query ships with explicit pagination*. Concretely:
- Notifications: `take: 50` + cursor on `(createdAt, id)`; the SSE backfill query gets `take: 200` with a documented "older than that → client fetches via list API" rule.
- Collection, friends, decks: `take: 48/50` + cursor (or simple offset — fine at this scale, cursor is barely harder and survives concurrent inserts).
- Club roster: single query with `include`, naturally bounded — document that no pagination is deliberate.

This is cheap to specify now and expensive to retrofit through five phase sub-plans later. **IMPORTANT, not Critical** — at realistic DACH scale (even 10k users) these tables stay in the thousands-of-rows range for years; the failure mode is a slow creep, not a launch-day cliff.

### P4 — `select`/`include` scoping: acknowledged gap, negligible perf cost — noted, not re-litigated

The plan's Task 7 honest-scope note (~line 1205) already concedes `resolveVisibleFields` is post-fetch projection and defers a column-level `select` variant to Phase 4+. `review-backend-security.md` Important #9 covers the privacy dimension. **The performance dimension is negligible at this scale** — a User row is ~300 bytes; fetching `passwordHash` you don't need costs nothing measurable versus the network and serialization overhead. Verdict: fix it for privacy when Phase 4 hardens the query layer (one place: build the `select` from the same visibility map), but don't let anyone claim it's a performance task. No new finding here; recorded so the next reviewer doesn't re-open it.

### P5 — `notifyUsersInRadius` scans the user table with JS-side haversine — NICE-TO-HAVE

**Reference:** Phase 3 `lib/notify.ts` (~line 1756): "queries `User` where `notifyRadiusKm` covers the tournament's `(latitude, longitude)`". The schema has no spatial type; the natural implementation is `findMany({ where: { latitude: { not: null }, notifyRadiusKm: { not: null } } })` then haversine in JS.

At DACH scale (single-digit-thousands of opted-in users) fetching `(id, lat, lng, notifyRadiusKm)` for all of them is a sub-10ms query — **fine**. If the filter is implemented as `findMany` *without* a field subset, it drags along every user column including `passwordHash` for the whole table — still fine at this size, but pointless. Two cheap improvements, neither urgent:

- Add a bounding-box prefilter (`lat BETWEEN t.lat ± r/111, lng BETWEEN … / cos(lat)`) either in the Prisma `where` or in a raw SQL haversine, so the JS pass sees only plausible candidates. (Also the query-pattern index on `(latitude, longitude)` already suggested in `review-backend-security.md` NICE-TO-HAVE #23.)
- `select` only the four fields needed before the JS loop — this is the one place in the plan where `select` has a real (if small) performance rationale, because it's a whole-table read.

**NICE-TO-HAVE** — the trigger is tournament creation (organizer-facing, seconds of latency budget), not a hot path.

### P6 — Remaining sketched Prisma calls — verified

- Task 3 db test, Task 5 register/login: single `findUnique`/`create` — fine.
- Task 6 `getRegistrationOptions`: `findUnique` user + `findMany` passkeys, 2 queries, no N+1 (could be one `include`, saving 1ms; not worth specifying).
- Task 7 privacy PATCH, Phase 2 ruleset CRUD, Phase 5 deck validation: single-row operations — fine.
- Phase 5 bracket: `generateSingleEliminationBracket` operates in memory on one `include`d fetch — correct shape; just make sure the fetch is one query (`tournament.findUnique({ include: { matches: true, participants: true } })`), not per-match queries. The plan doesn't sketch it either way; one line in the Phase 5 sub-plan pins it.
- Score route: match → ruleset join, then conditional write — correct.

---

## 3. Redis Usage Efficiency

### P7 — `rateLimit()` is INCR + conditional EXPIRE: two round trips and a TTL-loss race — IMPORTANT

**Reference:** Task 5 (~lines 703–709):

```ts
const count = await redis.incr(redisKey)
if (count === 1) await redis.expire(redisKey, windowSeconds)
```

Two issues:

1. **Round trips:** 2 per call on the first hit of a window, and the login path calls it twice (per-username *and* per-IP, ~line 831), so 4 round trips before bcrypt even starts. At ~0.5ms/RT on the docker network this is noise next to bcrypt's ~100–250ms — **the latency argument alone would be Nice-to-have.**
2. **The race is the real finding:** if the process dies (or Redis hiccups) between `INCR` returning 1 and `EXPIRE` executing, the key has no TTL and that `(ip, route)` bucket is rate-limited *forever* — a permanent, silent lockout of one IP from `/api/register`, curable only by manual `DEL`. A Lua script makes count-and-expire atomic in one round trip:

```ts
const LIMITER_LUA = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
  return count`
const count = (await redis.eval(LIMITER_LUA, 1, redisKey, windowSeconds)) as number
```

(or `redis.defineCommand` once at module load). **IMPORTANT** — small probability, but the failure is silent and permanent, and it's a 10-line fix while `lib/rateLimit.ts` is being born in Phase 1. Specify the Lua variant in Task 5 instead of the INCR/EXPIRE pair.

### P8 — Tile proxy Redis path is efficient — verified

`GET buffer` on hit (1 RT), `SET` on miss (1 RT) — already minimal. The per-instance single-flight map plus the Redis layer is the right two-level design (cross-time dedup + cross-request dedup). No pipeline needed: there is nothing to batch. `getBuffer`/`set(Buffer)` is the correct binary API in ioredis. The one operational caveat (Redis memory bound + eviction policy for a 14-day tile cache) was already covered by `review-backend-security.md` Important #12 — from the performance side, `allkeys-lru` with a `maxmemory` cap is *also* the right performance answer (hot DACH tiles stay resident), so that fix doubly stands.

### P9 — Bulk operations that could pipeline but don't need to yet — NICE-TO-HAVE

- `notifyUsersInRadius` publishes once per notified user (per-user channel, correct design from the privacy review). Under 1k publishes this is fine; if it's ever thousands, wrap in a pipeline (`redis.pipeline()` with all `publish` calls, one flush). One sentence in the Phase 3 sub-plan suffices.
- WebAuthn challenge consumption is `GET` + `DEL` (2 RTs); Redis ≥6.2 has `GETDEL`, one RT. Trivial; fold into the same note.
- Currency cache: GET-miss → SET-NX lock → fetch → SET already has the concurrency guard (good); on hit it's 1 RT. Fine.

No other Redis call site sketched in the plan benefits from pipelining — the workloads are request-scoped and small.

---

## 4. Client-Side JS Bundle Weight

### P10 — Heavy libraries are route-scoped but the plan never says so — IMPORTANT (as a specified constraint, not a measured problem)

**Reference:** Task 9 (`npm install leaflet`, ~line 1493); Task 6 (`@simplewebauthn/browser`, `otplib`, `qrcode`, ~line 903); Phase 2 (`@react-pdf/renderer`, ~line 1729); Phase 3 `LeafletMap.tsx` (~line 1748).

Inventory by where the bytes land:

| Library | Server or client? | Verdict |
|---|---|---|
| `@react-pdf/renderer` | Server-only (PDF route streams bytes) | Fine — never ships to the browser |
| `otplib` | Server-only (TOTP verify in `authorize`/setup) | Fine |
| `qrcode` | Server-only (QR rendered into the setup route response) | Fine |
| `@simplewebauthn/browser` | Client, but only imported by the login/passkey pages | Fine — Next.js route-level splitting keeps it off other routes, **as long as it's never imported into a shared layout/header component** |
| `leaflet` + `leaflet.css` | Client, `LeafletMap` is only rendered on `/events` | Fine per route splitting — Leaflet (~150KB min) costs the events page, nobody else |
| Judge UI (`JudgeScorePad`, bracket view) | Client, judge route only | Fine; and the offline SW *must* cache this closure, which Phase 5 Part C already plans |

So the bundler does the right thing **by default** — but only if nobody imports these libraries from a shared component, which is exactly the kind of drift five phase sub-plans written by different agents produce. The plan already has the zero-CDN guard test as a standing regression guard; add the bundle analog:

**What to change:** add one standing acceptance item (Cross-Phase Regression Guard): *`leaflet`, `@simplewebauthn/browser`, and judge/deck-builder modules may only be imported from components rendered on their own routes — never from `app/layout.tsx`, Header, or other shared components.* Optionally enforce mechanically: a tiny lint rule or a source-scan test asserting `from 'leaflet'` appears only under `components/map/` and `app/events/`. Additionally: load `LeafletMap` via `next/dynamic({ ssr: false })` in the events page (required anyway since Leaflet touches `window`) — state it in the Phase 3 sub-plan so the first implementation gets it right.

**IMPORTANT as an explicit constraint; not a measured defect today.** The current plan doesn't violate it anywhere — this is cheap insurance against the most plausible future bundle regression.

### P11 — Root-layout client components — verified fine

`ThemeProvider` + `RegisterServiceWorker` + `InstallPrompt` hydrate on every page. All three are small (context, an effect, a listener); combined cost is a few KB of JS + three hydrations, unavoidable for their function. No change. (Font loading is also right: single variable woff2, `font-display: swap`, self-hosted — no render-blocking third-party font CSS.)

---

## 5. Images & Static Assets

### P12 — No image/avatar handling exists at all — product gap AND performance trap — IMPORTANT

**Reference:** spec §3 schema (verbatim in Task 3) — `User`, `Part` (added Phase 5 Part A, ~line 1795), `Build`, `CollectionItem` have **no image field**. No task in any phase mentions avatars, part photos, `next/image`, image upload, or image sizing.

This is squarely both gaps the brief asks about:

- **Product:** a collection manager and social platform for physical collectible toys with zero imagery is a visible spec shortfall (spec §2.A's parts DB, §2.D profiles). It *will* be requested the week after launch.
- **Performance:** if it's then implemented ad hoc — `varchar` URLs or, worse, uploaded multi-MB phone photos rendered with plain `<img>` at full resolution in a grid of 200 collection items — it becomes the worst performance defect on the site (mobile LCP blowout, hall-Wi-Fi pain, data cost). The fix is architectural and must exist *before* the first image lands.

**What to change:** decide in the Phase 5 Part A/B sub-plan (when `Part` and collection exist):
1. Add `imageUrl String?` to `Part` (catalog images, admin-curated, few hundred files → serve from `/public` or a static dir, no upload pipeline needed at this scale) and `avatarUrl String?` to `User` (if avatars are in scope at all — deciding *no avatars* is a legitimate call; the plan should make it explicitly rather than by omission).
2. All image rendering goes through `next/image` with explicit `sizes` + fixed `width`/`height` (or `fill` with an aspect box) — this gives responsive downsizing, lazy loading, and AVIF/WebP conversion for free, entirely self-hosted, consistent with the zero-CDN constraint (the default Next image optimizer is same-origin; no external service is involved).
3. If user uploads are ever allowed: cap upload size, accept only downscaled web formats, store outside the image, and *document* the decision — don't let it emerge from a phase sub-plan unprompted.

**IMPORTANT.** Not Critical — nothing is slow *today* because nothing renders images. But this is the highest-leverage performance decision the plan currently omits, and retrofitting image optimization after ad-hoc `<img>` tags ship is real rework.

---

## 6. Architecture Fitness (the "framework shortcut?" question)

### 6a. OSM tile proxy: Next.js + Redis is fast enough — honest verdict, one caveat — NICE-TO-HAVE (documentation)

**Question asked:** would a dedicated lightweight service (Go/nginx cache layer) meaningfully outperform the Next.js route handler?

Honest numbers: a tile cache hit is `redis.getBuffer` (~0.3–0.5ms on the docker network) + constructing a `Response`. A Node route handler adds ~0.5–1ms of framework overhead per request versus raw nginx — call it 1–2ms/tile total difference. Realistic DACH map load: an events page with a few dozen concurrent viewers panning generates a few hundred tile requests/minute, mostly browser-cache hits (the plan sets `cache-control: max-age=86400`, correct). A single Node process serves thousands of these per second without breathing hard. **Extracting tile serving to Go/nginx would buy milliseconds nobody can perceive, at the cost of a second service to build, secure, and Watchtower-update. Next.js-only is the pragmatic and correct choice** — this is not a framework shortcut that costs real performance; the Redis layer is doing the actual work and it's the right tool.

One caveat worth one line in the plan: tile bytes transit the app container's event loop, which also serves SSE, pages, and APIs. At DACH scale the tile volume is far too low to matter, but if map traffic ever became a dominant share of requests (e.g. an embed goes viral), the tile route is the *first* thing to extract — say so in the Phase 3 sub-plan so the extraction decision is pre-authorized rather than discovered mid-incident.

### 6b. SSE in a single container: no real constraint at this scale — verified, one deploy note

**Question asked:** practical concurrent-connection ceiling for long-lived SSE in one Next.js route handler?

A Node.js process holds idle SSE connections at a few KB of heap each; tens of thousands of concurrent idle streams per container is routine territory, and the workload here is overwhelmingly idle (heartbeat every 25s, occasional publish). Traefik proxies SSE fine provided buffering is off and heartbeats flow — both already specified in the plan (~line 1758, added by the frontend review). The realistic ceiling for *this* platform is hundreds of concurrent users on a good day: **three orders of magnitude of headroom.** This is not a constraint the plan needs to engineer around.

Two honest notes (neither requires design change):
- **Every Watchtower deploy kills all live SSE connections** (single container, hard restart — already acknowledged as big-bang cutover in the plan/backend review). Browsers' default `EventSource` auto-reconnect makes this a ~1s blip for clients; just verify the client-side `EventSource` is constructed with default retry behavior and the server handles rapid reconnect (the durable-row replay on connect, already specified, covers message loss during the blip). One acceptance line in the Phase 3 sub-plan.
- If Next.js ever ships the route handler through a buffering/compression middleware, the stream stalls — the plan already flags `runtime = 'nodejs'`; add "no compression on this route" to the same note. **NICE-TO-HAVE.**

### 6c. Judge scoring transport: REST + offline queue is the performance-correct choice — verified, affirmed

**Question asked:** is REST a shortcut versus WebSockets? **No — for this constraint it's the right answer, and WebSockets would be the mistake.** The judge's defining environment is *no network at all*; a WebSocket buys live server push but (a) does nothing while offline, which is when the product must work; (b) adds connection-state fragility on hall Wi-Fi (reconnect storms, missed windows during AP roaming) to the most correctness-critical write path in the app; (c) would still need the exact same durable queue underneath, because a WS disconnect mid-match is guaranteed. Full-state idempotent POST + IndexedDB queue + four-trigger flush converts " flaky connectivity" from a failure mode into a non-event, and the write volume (a score every ~30–90 seconds per active judge) is so low that request-per-entry REST has zero throughput concern. The plan's choice here — strengthened by the frontend review's idempotency fixes — is the architecturally sound one; do not let any future sub-plan "upgrade" it to WebSockets.

The only perf-shaped refinement (**NICE-TO-HAVE**): on reconnect, a judge device may flush dozens of queued entries as dozens of sequential POSTs. Specify a *bounded* flush batch (e.g. up to 10 entries per request body to a batch endpoint, or simple sequential-with-keepalive HTTP/1.1 pipelining via `fetch` concurrency of ~4) — while keeping per-item error isolation (frontend review I3's requirement) so one poisoned entry doesn't block the rest. At realistic queue depths this saves seconds at most; hence nice-to-have, not important.

---

## 7. Build Performance & Docker Image Size

### P13 — Runtime stage is correctly minimal — verified

The Phase 6 Dockerfile runtime stage (~lines 1878–1890) copies only `.next/standalone`, `.next/static`, `public`, `prisma/`, and three targeted `node_modules` subtrees (`.bin/prisma`, `prisma`, `@prisma`) — **not** the full `node_modules`. That's exactly right: standalone tracing already carries the production deps, and the three extra copies are the minimal set for `prisma migrate deploy` to run offline (CLI + its engine packages) without a full node_modules. `.dockerignore` is in the file list. `deploy.yml` uses buildx with `cache-from/to: type=gha, mode=max` (~lines 1869–1873), so layer and BuildKit cache persist across CI runs — the standard, correct answer for build speed. Nothing here bloats the image or the cold start beyond what the design requires.

### P14 — `npx prisma migrate deploy` on every container start — a second or two per boot, gate it if you care — NICE-TO-HAVE

Every Watchtower-triggered restart (i.e., every merge to main) pays the Prisma schema-engine boot + drift check against the migrations table before `node server.js` starts (~1–3s of extra downtime per deploy, on top of Next.js's own boot). Two cheap mitigations, either optional:

- Point the CMD at the CLI directly (`node node_modules/prisma/build/index.js migrate deploy`) rather than `npx` — npx does a package resolution pass that can attempt a registry hit in some configurations; the direct path is deterministic and offline-safe. (Also makes the `.bin/prisma` copy redundant.)
- Cache the "no pending migrations" state (e.g. skip when the image's migration folder hash matches a value recorded in Postgres at build/boot) — probably over-engineering for deploys that happen a few times a week.

**NICE-TO-HAVE** — at actual deploy frequency this is single-digit seconds of downtime per merge, already bounded by the healthcheck the plan specifies.

### P15 — Node 20 is EOL (2026-04); Dockerfile pins `node:20-alpine` and CI pins node 20 — note, not a perf finding

**Reference:** Dockerfile runner stage (~line 1879), `ci.yml` (`node-version: 20`, ~line 1682). Node 20 reached end-of-life in April 2026; Node 22 is the active LTS (24 available). Beyond hygiene/security, 22+ ships a meaningfully faster V8 for the hot paths this app has (JSON, buffers — i.e., tile serving and RSC serialization). Move both pins to `node:22-alpine` (or 24) in Phase 1 Task 1/Phase 6 — a one-line change in each file, no code impact expected for Next.js 15. Flagged here because no prior review caught it; classify as hygiene riding along with this review rather than a numbered perf finding.

---

## 8. Caching for Read-Heavy Public Pages

### P16 — No caching directives on public read-heavy pages; Next.js 15 defaults are fully dynamic — IMPORTANT

**Reference:** Phase 2 `app/rules/[slug]/page.tsx` (~line 1725); Phase 3 `app/feed/**/route.ts` (~line 1754), `app/events/page.tsx` (~line 1749).

Next.js 15 changed the default: GET route handlers and pages are **not** cached unless you opt in (`export const revalidate`, `dynamic = 'force-static'`, or `unstable_cache`). Nothing in the plan opts in anywhere. Consequences:

- **`/rules/[slug]`** (public, changes only when the owner edits): every view = auth + Postgres + render. At DACH traffic this is a few ms of DB time — genuinely fine — but it's also the page most likely to be linked from social media and hit in bursts (a viral ruleset share). One line — `export const revalidate = 300` — makes a burst free.
- **RSS feeds**: feed readers poll on their own schedule (every 15–60 min per subscriber per feed), and there are three feed routes that each run a tournaments query + XML build per hit. `review-frontend-pwa.md` N4 already asked for `Cache-Control` headers; the cleaner Next-native answer is `export const revalidate = 900` on the feed route handlers, which sets both ISR caching *and* the s-maxage header in one directive. This subsumes N4 rather than duplicating it.
- **`/events`** (calendar + filters): mostly-static data over a minute's horizon; `revalidate = 60` is a reasonable default. Slightly more care needed since filters are query-param driven — cache per-URL is automatic with ISR, so still one line.

**Equally important — what must NOT be cached**, so phase sub-plans don't over-apply the pattern: tournament bracket and judge pages (live scoring data — dynamic is correct), anything under `/profile`, `/collection`, `/decks`, `/api/notifications*` (per-user, privacy-sensitive), the tile proxy (Redis already caches), and any auth-adjacent route. State this explicitly in the Phase 3/5 sub-plans; "add revalidate everywhere" would be a privacy and correctness regression.

**What to change:** add a standing note to the Cross-Phase Regression Guard: *public, anonymous-readable, infrequently-mutated pages (rulesets, RSS feeds, events list) carry an explicit `revalidate`; per-user and live-tournament surfaces are explicitly `dynamic = 'force-dynamic'`.* **IMPORTANT** — cheap now, and it prevents both the uncached-burst problem and its overcorrection.

---

## Consolidated Punch List

### CRITICAL
*(none — see Executive Summary. The architecture is appropriately sized for the stated workload; the highest-impact items below are design-time specifications, not measured defects.)*

### IMPORTANT — specify before the relevant phase's sub-plan is written

1. **Standing pagination rule** (§2/P3): `take`+cursor on notifications (50/200-bounded backfill), collection, friends, decks lists; add to Cross-Phase Regression Guard.
2. **Atomic rate limiter** (§3/P7): single Lua script (`INCR`+`EXPIRE` atomic) or `defineCommand` in Task 5, replacing the INCR/conditional-EXPIRE pair.
3. **Image strategy** (§5/P12): decide before Phase 5 Part A/B — `Part.imageUrl` (+ optional `User.avatarUrl`), all rendering via `next/image` with explicit sizes; explicitly decide avatars in or out.
4. **Cache-directive policy** (§8/P16): `export const revalidate` on ruleset pages (300), RSS routes (900), events (60); explicit `force-dynamic` on bracket/judge/profile/collection/notifications; add both halves to the regression guard.
5. **Bundle-scope guard** (§4/P10): leaflet/webauthn-browser/judge modules importable only from their own routes (lint or source-scan test); `next/dynamic({ ssr: false })` for `LeafletMap`.

### NICE-TO-HAVE

6. Profile page `Promise.all` for user+friendship fetches (§1/P1); batch friendship lookup as one `findMany` returning a `Set` (same fix as backend-review #13, performance-confirmed).
7. `notifyUsersInRadius`: `select` the four needed fields + bounding-box prefilter (§2/P5); pipeline the per-user publishes when count is large (§3/P9); `GETDEL` for WebAuthn challenge consumption (§3/P9).
8. Bracket fetch specified as one `include`d Prisma query (§2/P6); Phase 5 flush batching with per-item error isolation (§6c).
9. Tile-proxy extraction named as the first escape hatch if map traffic ever dominates (§6a); SSE "no compression + default EventSource reconnect" acceptance lines (§6b).
10. Dockerfile: direct `node …/prisma/build/index.js migrate deploy` CMD (§7/P14); bump Node pin 20 → 22+ in Dockerfile and CI (§7/P15).
11. Column-level `select` in the privacy layer when Phase 4 hardens it — for privacy, not performance (§2/P4; do not re-open as a perf item).

---

## Calibration Statement

This plan was already performance-reviewed twice by construction: the backend review forced the Redis topology, tile-cache versioning, and rate limiting into existence, and the frontend review forced single-flight tile dedup, SW asset-closure caching, and idempotent full-state score payloads — which are also, not coincidentally, the performant implementations. What remains in this document is mostly *specification discipline* (pagination, cache directives, bundle-scope guard, image strategy) rather than *defect repair*. Nothing found here justifies changing the architecture, the framework, the transport choices, or the deployment model. The stack is not being used as a shortcut; it's being used as intended, at the scale it was designed for.
