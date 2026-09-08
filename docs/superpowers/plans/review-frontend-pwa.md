# Review: BeybladeX.de Master Plan — Frontend/PWA Deep Review

Review of `docs/superpowers/plans/2026-09-08-beybladex-master-plan.md` (1409 lines) against the spec `~/Downloads/BeybladeX.de - Master Projekt Spezifikation.md`, focused on six areas: (1) offline-first judge flow, (2) theme/zero layout shift, (3) mobile judge UI, (4) Leaflet + tile proxy, (5) RSS/SSE notifications, (6) phase sequencing.

Classification legend: **UNDERSPECIFIED** = plan lacks the detail an implementer needs; must be filled in before that phase/task starts. **DESIGN FLAW** = what the plan *does* specify is wrong/buggy. **NICE-TO-HAVE** = optional improvement.

---

## Critical (blocks correctness or UX, must fix before implementation starts)

### C1 — The judge page will not actually work offline as the SW is written (Area 1 — PWA judge flow) — DESIGN FLAW + UNDERSPECIFIED

**Reference:** Phase 1, Task 8, Step 5 (`public/sw.js`, plan lines 1043–1068); DoD line 1248 ("`/tournaments/x/judge` … is servable offline after one visit").

The service worker intercepts only requests matching `/tournaments/*​/judge` and caches only the HTML document (`cache.put(event.request)` in the network-first handler). A Next.js App Router page needs its `_next/static/*.js/.css` chunks and RSC payload to render and hydrate — none of those URLs match the SW's `startsWith('/tournaments/')` filter, so they are never cached and all fail offline. The cached HTML shell will load and render a broken, unhydrated page. Additionally, `OFFLINE_URLS = ['/offline.html']` (line 1046) references a file **no task in the plan ever creates**, so the SW's `install` event (`cache.addAll`) will reject and the entire service worker will fail to install.

**Fix:** Before Phase 1 Task 8 Step 5, specify: (a) create `public/offline.html` as an explicit file entry; (b) extend the fetch handler to cache the judge page's full asset closure — either precache the judge route's build artifacts (discover `_next/static` chunks for the route at build time, or use a runtime cache with a strict allowlist: `/_next/static/`, the judge document, and its RSC/data fetches) or make the judge page a self-contained route whose JS/CSS is listed in a build-generated manifest the SW consumes. Add a Playwright offline assertion to Phase 1 DoD (line 1248) that verifies the page *hydrates and renders match data* offline, not merely that HTTP 200 comes back.

### C2 — No conflict resolution or idempotency for offline scoring; the queue is flushed by two writers with no dedup (Area 1) — UNDERSPECIFIED

**Reference:** Phase 5, Part C (lines 1341–1343): `lib/offline/matchQueue.ts` ("called on `online` event and via the service worker's background sync"); `app/api/matches/[id]/score/route.ts`.

Three interlocking problems the plan never addresses:

1. **Two judges, same match, both offline.** The plan has zero conflict-resolution story. `Match` (spec §3) stores only `scorePlayer1`, `scorePlayer2`, `winnerId`. With last-write-wins sync, the second judge to reconnect silently overwrites the first judge's scores. In a sports hall with two judges covering adjacent tables this is a realistic data-loss scenario, not an edge case.
2. **Double-flush race.** Scores are flushed both by the page (`online` event) and by the SW's `sync` event. Nothing in the plan defines a "flushing" lock, per-item `sent` flag, or idempotency key, so the natural implementation double-POSTs queued items.
3. **Payload shape unknown.** If `enqueueScore(matchId, payload)` sends *point increments* ("Spin +1"), any retry or duplicate corrupts the score. If it sends *full-match state*, it is naturally idempotent.

**Fix:** Specify in the Phase 5 Part C sub-plan: full-match-state (idempotent) payloads with a client-generated `clientEventId` UUID per queue entry; a unique constraint / upsert on `clientEventId` server-side; a per-device "flushing" flag so `online`-event flush and `sync` flush can't run concurrently; and a conflict policy — recommended: match-level judge assignment (`Match.judgeId` already exists — assign each match to exactly one judge and reject writes from a different judge with 409) plus a `lastUpdatedAt`/version check so a stale offline write surfaces as a visible conflict for manual resolution instead of silently overwriting.

### C3 — Service worker update/versioning strategy is absent; Watchtower makes this worse (Area 1) — UNDERSPECIFIED + DESIGN FLAW

**Reference:** Task 8 (lines 1044–1068): `CACHE_NAME = 'beybladex-judge-v1'` hardcoded; no `activate` handler, no old-cache deletion, no `skipWaiting()`/`clients.claim()`, no update prompt. Phase 6: Watchtower auto-redeploys on every merge to `main` (line 1400).

During a tournament, judge devices may be offline for hours. Meanwhile every merge to main ships a new build. Consequences the plan never discusses: (a) Next.js chunk hashes change every build, so a cache named `beybladex-judge-v1` that survives across builds serves **stale HTML referencing deleted JS chunks** after redeploy; (b) a device that comes online mid-tournament may pick up a new SW and cached-assets mismatch mid-session; (c) old caches are never deleted, so storage grows unboundedly.

**Fix:** Specify in Task 8: a build-derived cache version (e.g. inject `process.env.NEXT_BUILD_ID` or a version constant bumped per release), an `activate` handler that deletes all caches not in the current allowlist, and a deliberate update policy for judge routes — e.g. do **not** auto-`skipWaiting()` on the judge scope during active tournaments; instead show an "Update available — safe to update between rounds" prompt, or pin the judge page to runtime caching keyed by build with cleanup on activate. Add an acceptance criterion: "redeploying a new build while a judge device is offline does not break the already-cached judge page, and stale caches are cleaned up on update."

### C4 — ThemeProvider as specified produces a flash of wrong theme on every load, contradicting the plan's own constraint and DoD (Area 2 — theme) — DESIGN FLAW

**Reference:** Global Constraints line 22 ("no layout shift on toggle"); Task 2 Step 3 (lines 261–301): the `dark` class is applied in `useEffect` (lines 285–287) after hydration, and the stored theme is read in `useEffect` (lines 278–281); layout note line 349 (`suppressHydrationWarning`); DoD line 1247 ("no visible flash/layout shift").

This is the classic FOUC: the server renders `<html>` without the `dark` class, the browser paints light theme, then the post-hydration `useEffect` flips the class. A dark-mode user gets a white flash on every page load — directly violating the stated "no visible flash" acceptance criterion. `suppressHydrationWarning` only silences the React warning; it does not prevent the flash. Note the plan even *knows* the pattern (it mandates inline pre-paint script thinking for nothing) but implements the client-side-only variant.

**Fix:** Add a blocking inline script in `<head>` (in `app/layout.tsx`, before stylesheets) along the lines of:
```html
<script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('beybladex-theme');var d=t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;if(t==='dark'||(t!=='light'&&d))document.documentElement.classList.add('dark')}catch(e){}` }} />
```
Keep the React provider for the toggle and `system` mode, but the initial class must come from the inline script. Add an e2e/Playwright assertion to the DoD (line 1247): load with `prefers-color-scheme: dark` + stored dark theme and assert `document.documentElement.classList.contains('dark')` *before* hydration/first paint (or assert via screenshot diff that no light flash occurs).

### C5 — Task 2's own test contradicts its own implementation: the TDD cycle breaks at "verify it passes" (Area 2 — theme) — DESIGN FLAW

**Reference:** Task 2 Step 1 test (lines 236–251) vs. Step 3 implementation (lines 304–323).

The test's first click expects `localStorage.getItem('beybladex-theme')` to be `'dark'` (lines 244–245). The `ThemeProvider` defaults to `'system'`, and `ThemeToggle.cycle()` computes `next = ORDER[(ORDER.indexOf('system') + 1) % 3]` = `ORDER[0]` = `'light'` (lines 309–315). First click therefore stores `'light'`, and the test fails at Step 4 ("Expected: PASS"). The executor following the plan literally will hit a red step the plan claims is green.

**Fix:** Either change `ORDER` to `['system', 'light', 'dark']` (so the cycle out of `system` lands on `dark` first) or change the test's expected sequence to `light → dark → system` starting from `system`. One line either way — but it must be resolved in the plan, not left for the executor to "fix" mid-task.

---

## Important (should fix before the relevant phase starts, but not an immediate blocker)

### I1 — iOS Safari fallback is half-specified: Background Sync is a no-op there, and the `online` event alone is insufficient (Area 1) — UNDERSPECIFIED (partially present)

**Reference:** Phase 5 Part C, line 1341 ("`flushQueue()` — called on `online` event and via the service worker's background sync"); line 1342 (SW `sync` handler).

To the plan's credit, an `online`-event fallback *is* mentioned — that answers the "does the plan have an iOS fallback" question with a partial yes. But it's incomplete: (a) Background Sync (`sync` event) is **not supported in Safari/iOS** (as of iOS 18), and Periodic Background Sync is Android/Chrome-only, so on iOS the SW sync path is dead code; (b) the `online` event fires on *interface connectivity*, not internet reachability — in a spotty hall it can fire with no usable route to the server, and a failed flush then needs a retry-with-backoff policy that isn't specified; (c) if the judge backgrounds/kills the tab or the device sleeps between scoring and reconnecting, the `online` event never fires while the page is closed — on iOS the flush only happens when the user reopens the page, so **flush-on-page-load and on `visibilitychange`** must also be specified; (d) the plan never states the supported-browser matrix or that iOS is a first-class target for judges (statistically, many judges will have iPhones).

**Fix:** In the Part C sub-plan: state explicitly that Background Sync is progressive enhancement (supported: Chrome/Edge/Android; not supported: iOS Safari) and that the authoritative trigger set is `window 'online'` + page load + `visibilitychange`→visible, each calling `flushQueue()` with single-flight locking and exponential backoff on failure. Add an iOS Safari manual test to the acceptance criteria alongside the Playwright test (line 1344), since Playwright's Chromium exercises the Background Sync path, not the iOS path.

### I2 — Network-first fetch with no timeout is the wrong strategy for spotty sports-hall connectivity (Area 1) — DESIGN FLAW

**Reference:** Task 8 Step 5 fetch handler (lines 1052–1067): `network-first`, falling back to cache only after `fetch()` rejects.

"Flaky" is worse than "offline": TCP connects hang rather than fail, so on a spotty connection the judge page navigation can sit for tens of seconds before the cache fallback kicks in — precisely when a judge is trying to open the page between matches. There is no timeout wrapper, no `AbortSignal.timeout`, and no stale-while-revalidate option.

**Fix:** For judge-route documents and their assets, use cache-first-with-background-revalidation (stale-while-revalidate) or network-first bounded by a ~3–5 s `AbortSignal.timeout`, falling back to cache. Specify this in Task 8 and test it with Playwright's `context.setOffline` *plus* a throttled/intercepted-slow-response case.

### I3 — Queue ordering, head-of-line blocking, and retry semantics are undefined (Area 1) — UNDERSPECIFIED

**Reference:** Line 1341: `enqueueScore(matchId, payload)`, `flushQueue()`.

Nothing specifies: per-device monotonic sequencing; whether a failed POST at the head of the queue blocks later entries (it must not — later matches' scores should still sync, or at minimum the plan must consciously choose blocking); max queue depth; what happens when IndexedDB writes fail (storage pressure on iOS is a real eviction risk); or how out-of-order arrival is handled server-side for two scores for the *same* match queued minutes apart.

**Fix:** Specify in the sub-plan: IndexedDB store with auto-increment `seq`, per-entry states (`pending`/`sending`/`acked`/`failed`), in-order best-effort flush with per-item error isolation, server-side ordering by `seq`/`clientEventId` for same-match writes, and a visible "N scores pending sync" indicator in the judge UI (judges must be able to *see* unsynced state).

### I4 — No offline snapshot of match data: a reload while offline blinds the judge (Area 1) — UNDERSPECIFIED

**Reference:** Phase 5 Part C (lines 1337–1344): `matchQueue.ts` queues *scores* only; no task caches the tournament/match payload (player names, bracket, current round) that the score pad renders.

The acceptance criterion (line 1349) — "score a full match with the device in airplane mode" — is satisfiable if the page stays open, but if the judge accidentally reloads, closes the tab, or iOS evicts the tab mid-tournament, the cached HTML (per C1's fix) renders with no data, because the match-data fetch fails offline.

**Fix:** On every successful load, persist the tournament match payload to IndexedDB (e.g. `idb-keyval` or a small wrapper in `lib/offline/`) and hydrate the judge UI from it when the network fetch fails. Add a Playwright step: load online → go offline → reload → score a match → reconnect → assert server state.

### I5 — Judge touch UI is specified by exactly one number; the rest is hand-waving (Area 3 — responsive judge UI) — UNDERSPECIFIED

**Reference:** Phase 5 Part C, line 1340: "`JudgeScorePad.tsx` (touch targets ≥44px, per mobile-first constraint)"; Task 10 Step 5 (lines 1224–1226): bottom tab bar; spec §2.C line 77: "Touch-optimiertes Offline-Judge-Interface".

That is the entirety of the concrete mobile guidance for the flagship UX. Missing, and needed before the Part C sub-plan is written:

- **One-handed reachability**: scoring happens one-handed while the other hand holds the arena/launcher. Primary actions (Spin/Over/Burst/Xtreme, confirm) must sit in the bottom 40–50% thumb zone; destructive/rare actions (undo, dispute) higher.
- **Frequency-weighted sizing**: "Spin" (every round) should be the biggest target; Xtreme Finish rare but must not be *too* hidden (mis-tap cost is high).
- **Mis-tap protection**: debounce, generous `touch-action`, an explicit undo/last-entry-revert, and a confirm for match-end — a double-tap must not award double points.
- **Screen Wake Lock API** (`navigator.wakeLock`): a judge phone that sleeps mid-match is a real failure; not mentioned anywhere.
- **Glare/contrast**: bright halls, dark theme default, minimum contrast for the score readout at arm's length; large numeric score display.
- **Orientation**: portrait-primary with a deliberate layout; landscape behavior unspecified.
- **Bracket view on small screens**: `JudgeBracketView.tsx` (line 1338) gets zero mobile guidance; a single-elim bracket needs a collapsed/current-round-first mobile presentation.

**Fix:** Expand line 1340's parenthetical into a short "Judge UI mobile spec" section in the Part C sub-plan (target map with px sizes, thumb-zone layout diagram in words, undo + wake-lock as named acceptance criteria, portrait/landscape rules). This is the single most user-facing surface of the whole project; one number is not a spec.

### I6 — Leaflet marker-icon bundler gotcha unaddressed; repo layout contradicts the install method (Area 4 — Leaflet) — UNDERSPECIFIED + DESIGN FLAW

**Reference:** Repo-wide structure (line 92): `public/leaflet/ # vendored Leaflet JS/CSS/marker images`; Task 9 Step 1 (line 1097): `npm install leaflet`; Phase 3 (line 1280): "`import 'leaflet/dist/leaflet.css'`".

Classic gotcha: Leaflet's CSS references `images/marker-icon.png` etc. via relative `url()`. Whether those URLs resolve after bundling depends on the bundler's CSS-asset handling; with Next.js/webpack it *usually* works, with Turbopack or standalone output it has historically broken, leaving marker-less maps. The plan neither acknowledges the gotcha nor picks one canonical approach — and the file tree implies a `public/leaflet/` vendoring approach that Task 9 then abandons for npm, leaving `public/leaflet/` as dead structure.

**Fix:** Pick one: (a) npm leaflet + explicit icon wiring (import the three PNG URLs and construct `L.Icon` / use `L.divIcon` with Tailwind-styled markers), or (b) genuinely vendored files under `public/leaflet/` loaded via `<link>`/`<script>` tags with `L.Icon.Default` pointed at those paths. Either way, add an acceptance test (Phase 3 already has a network-spy test at line 1296 — extend it or add a component test asserting the marker icon element has a resolved, non-404 image URL). Delete whichever of the two approaches isn't chosen from the plan.

### I7 — OSM attribution is missing entirely (Area 4) — DESIGN FLAW (compliance gap)

**Reference:** Task 4 (lines 452–545) implements the proxy without any mention of attribution; Phase 3 line 1280 mandates the tile source but not the attribution control.

Proxying tiles does not remove the OpenStreetMap copyright/license obligation — rendered OSM data requires "© OpenStreetMap contributors" attribution on the map. Omitting it violates the OSM tile usage policy and the underlying ODbL, and risks the proxy IP being banned.

**Fix:** Add to Phase 3's acceptance criteria: `LeafletMap` renders an attribution control containing `© OpenStreetMap contributors` (assert in the component/e2e test). One line in the plan; cheap to specify now.

### I8 — Tile proxy has no request coalescing, no upstream rate limiting, and no z/x/y validation (Area 4) — UNDERSPECIFIED + DESIGN FLAW

**Reference:** Task 4 Step 4 route implementation (lines 505–533).

- **Cache stampede**: `cached` miss → immediate upstream `fetch`. Twenty users panning the same region concurrently = twenty upstream requests for the same tile. Redis prevents *re-fetch across time*, not *concurrent* fetches.
- **Upstream rate limit**: the OSM tile usage policy caps requests (2 req/s per source IP); a burst on a popular event page can get the server's IP throttled/banned, which then degrades every map view.
- **No input validation**: `z`, `x`, `y` are passed straight to the URL and used as Redis keys. `z=99` or negative/non-integer values generate garbage upstream requests and unbounded Redis keys (abuse/amplification vector, and a 404-bomb).
- **TTL mismatch**: Redis TTL is 14 days (line 509) but the browser `cache-control` is 1 day (lines 519/531) — harmless, but shows the caching story wasn't thought through end-to-end.

**Fix:** Specify: (a) clamp/validate z (0–19), x, y as integers within range for z, 400 on violation; (b) per-key single-flight (in-memory `Map<key, Promise>` in the module) so concurrent misses share one upstream fetch; (c) a simple token bucket (e.g. 2 req/s) on upstream calls, with the browser-facing route returning a local placeholder tile or 503-with-retry on exhaustion; (d) decide TTL/coherence deliberately (14-day Redis TTL is fine for basemap tiles; align the `cache-control` comment or value).

### I9 — SSE delivery has no reconnection, missed-event, heartbeat, or auth story (Area 5 — RSS/notifications) — UNDERSPECIFIED

**Reference:** Phase 3 (lines 1288–1289): `notifyUsersInRadius` "publishes on a Redis Pub/Sub channel"; `/api/notifications/stream` "subscribes to the Redis channel."

Plausible core for small traffic, yes — but the gaps: (a) **Redis Pub/Sub is fire-and-forget with no persistence**: a client that disconnects (mobile network change, tab background, proxy hiccup) misses every notification published while down; there is no `Last-Event-ID`/offset recovery mechanism; (b) **no heartbeat**: SSE comments (`: ping`) every ~25–30 s are required to keep connections alive through proxies (Traefik) and to detect half-open TCP; (c) **channel granularity unspecified** — one global channel filtered client-side leaks every user's notifications to every connected client (a privacy hole: event titles/links would be broadcast to all); per-user channels (or a server-side filtered stream keyed to the session) must be specified; (d) **auth**: the endpoint must verify the NextAuth session before streaming (cookies do flow through `EventSource` same-origin, but the plan should state it, and the route needs `runtime = 'nodejs'` and to disable any response buffering/compression middleware that would hold the stream).

**Fix:** In the Phase 3 sub-plan: per-user pub/sub channel (`notify:{userId}`) or server-side filtering after session lookup; `Last-Event-ID` support reading missed `Notification` rows from Postgres (the rows already exist — replay them on reconnect); 25–30 s heartbeat comments; session check before `subscribe`; explicit `runtime = 'nodejs'` and buffering caveats. Fan-out cost is fine: it's one Redis publish per notified user, not per subscriber.

### I10 — The plan is internally inconsistent about which phase owns the judge flow (Area 6 — sequencing) — UNDERSPECIFIED

**Reference:** Task 8 note (line 986): "the Judge UI (Phase 3/5) extends" the SW; Task 8 DoD (line 1248): judge route servable offline already in **Phase 1**; Phase 3 scope (line 1277): "offline Judge scoring entry point"; Phase 5 Part C (lines 1337–1344): the actual judge implementation.

Four different places claim the judge flow, with overlapping but different scopes. An executor writing the Phase 3 sub-plan will not know whether to build the judge entry point there or defer to Phase 5; the Phase 1 DoD claims an offline capability whose real implementation lands four phases later.

**Fix:** Decide and state once: Phase 1 = SW shell + offline HTML stub only (adjust line 1248's wording to "serves a static offline stub"), Phase 3 = nothing judge-related (remove "offline Judge scoring entry point" from line 1277), Phase 5 Part C = the complete judge flow. Also fix line 986's "(Phase 3/5)" to "(Phase 5)".

### I11 — No CI until Phase 6, and no early proof of the riskiest component (Area 6 — sequencing) — UNDERSPECIFIED / resequencing recommendation

**Reference:** Phase 6 (lines 1354–1363) defines `ci.yml`; the Cross-Phase Regression Guard (lines 1404–1408) relies on manual re-running; Phase 5 Part C (lines 1337–1344) contains the offline judge POC, five phases in.

Two points: (a) Until Phase 6, nothing mechanically blocks a red suite from reaching `main` — for a plan that leans this hard on TDD, a minimal `ci.yml` (test + typecheck on PR) belongs in Phase 1 Task 1; the full deploy pipeline can stay in Phase 6. (b) The offline judge loop (IndexedDB queue + SW sync + conflict policy + Playwright offline test) is the most technically novel, highest-integration-risk piece in the entire plan, yet it is built last, after four phases of unrelated work. If the conflict/sync design (C2, I1–I4) needs to change shape, it risks reworking the match model late.

**Fix:** Two cheap resequencings: (1) add a Phase 1 task "minimal CI gate" (`ci.yml` with `npm test && tsc --noEmit` on every PR; extend to Playwright later); (2) add a Phase 1 stretch task or early Phase 2 task: "offline-sync vertical slice POC" — a trivially simple page (not the full judge UI) with the IndexedDB queue, SW sync handler, score POST, and the Playwright offline round-trip test. This de-risks the design while the schema is still plastic, and Phase 5 Part C then becomes UI work on a proven sync core. The overall 1→2→3→4→5→6 order is otherwise sensible (foundation genuinely first); this changes *within-phase ordering of the risk*, not the macro sequence.

---

## Nice-to-have (optional improvement)

### N1 — No live tracking of system theme changes (Area 2)

**Reference:** Task 2 (lines 271–287): `matchMedia('(prefers-color-scheme: dark)').matches` is read once; no `change` listener.

In `system` mode, toggling the OS theme while the app is open does nothing until reload. Add a `matchMedia(...).addEventListener('change', …)` subscription in the provider. Minor UX polish; the pre-paint script (C4) already handles the initial state.

### N2 — iOS has no `beforeinstallprompt`; install UX needs an Apple-specific path (Area 1/3)

**Reference:** Task 8 Step 5 (line 1070): `InstallPrompt.tsx` listens for `beforeinstallprompt`.

iOS Safari never fires this event; installation goes through the Share → "Add to Home Screen" sheet. Spec line 33 explicitly requires installability on iOS/Android/Desktop. Provide a one-time informational card for iOS/Safari user agents explaining the manual step. Nice-to-have, but cheap.

### N3 — Redis tile-store operations hygiene (Area 4)

**Reference:** Task 4 (lines 509, 529).

Tiles are binary blobs in the same Redis instance used for pub/sub and leaderboards; if no `maxmemory` policy is set, tile growth (14-day TTL × tile volume) competes with operational keys. Specify `allkeys-lru` (or a separate logical DB / instance) in the compose/redis config, and consider a placeholder tile for upstream 5xx so the map degrades gracefully instead of showing broken images.

### N4 — RSS feed response caching headers unspecified (Area 5)

**Reference:** Phase 3 (lines 1285–1286).

Feed routes regenerate on every hit. For a small site this is fine; adding `Cache-Control: public, max-age=900` (+ ETag) is a one-line win against feed-reader polling. Optional.

### N5 — Playwright offline test only exercises Chromium's Background Sync path (Area 1)

**Reference:** Phase 5 Part C (line 1344).

`context.setOffline` in Chromium validates the sync loop but not the iOS/manual-retry path (I1). Complement with a manual test checklist entry in the DoD: iPhone, Safari, PWA mode, airplane-mode scoring, verify flush on reopen. Optional but strongly recommended given the audience.

### N6 — Low-risk phases contain deferrable scope (Area 6)

**Reference:** Phase 2 (line 1262: PDF export via `@react-pdf/renderer`), Phase 5 Part B (line 1334: currency conversion).

Neither is risky, but both are polish independent of their phase's core. If timeline pressure ever appears, PDF export and multi-currency are clean candidates to descope/swap without touching the dependency graph — worth noting so a future sub-plan knows what's droppable.

---

### Summary of the six asked questions, tersely

1. **Offline judge flow:** Not reliable as specified — missing asset caching + missing `offline.html` (C1), no conflict resolution or idempotency (C2), no SW versioning (C3), network-first without timeout wrong for flaky halls (I2). iOS fallback partially exists (`online` event, line 1341) but is incomplete — no flush-on-load, no backoff, no stated browser matrix (I1).
2. **Theme:** As written, it **will** flash — class applied in `useEffect` after hydration contradicts the plan's own zero-flash constraint (line 22) and DoD (line 1247). Needs an inline blocking `<head>` script (C4). Bonus: the task's test contradicts its implementation (C5).
3. **Mobile judge UI:** Underspecified beyond one number (44px, line 1340). No thumb-zone layout, no wake lock, no mis-tap/undo, no bracket-on-mobile story (I5).
4. **Leaflet/tiles:** Marker-icon bundler gotcha unaddressed and the plan contradicts itself on vendoring vs npm (I6); OSM attribution missing (I7); no single-flight, no rate limit, no coordinate validation in the proxy (I8).
5. **RSS/SSE:** Core is plausible for small traffic, but no missed-event recovery (`Last-Event-ID`), no heartbeat, and the global-channel design as written would leak notifications across users (I9).
6. **Sequencing:** Macro order is fine, but the judge/offline sync should be spiked early (it's the highest-risk piece), minimal CI should exist from Phase 1, and the plan contradicts itself four times about which phase owns the judge flow (I10, I11).
