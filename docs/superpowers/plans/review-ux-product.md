# Critical Review: BeybladeX Master Plan — Product / UI / UX (Holistic)

**Plan reviewed:** `docs/superpowers/plans/2026-09-08-beybladex-master-plan.md` (1907 lines)
**Spec reviewed:** `BeybladeX.de - Master Projekt Spezifikation.md` (477 lines)
**Date:** 2026-09-08
**Scope of this review:** information architecture, onboarding, core user-flow completeness, the Auto-Meta Engine, spec-coverage gaps, visual/interaction design system, accessibility, search & discoverability. It deliberately does **not** re-litigate backend/security/data-model findings (`review-backend-security.md`) or PWA/offline/judge-pad findings (`review-frontend-pwa.md`) — those are incorporated into the plan via `[REVIEW-FIX]` markers and are treated as settled here.

**Classification:** **CRITICAL** = the product does not work as a product without it (a primary journey cannot be completed, or an explicit spec feature ships nowhere). **IMPORTANT** = should be added before the relevant phase starts; absence will produce a visibly broken or incoherent experience. **NICE-TO-HAVE** = polish.

---

## Executive Summary

The plan is strong on infrastructure, security, and offline correctness, and weak on *product*. It specifies routes, APIs, and schema mutations with precision, but almost nowhere specifies **screens a human uses to do a thing**. The recurring pattern: the data model and API layer exist, the UI layer that would make a feature reachable by a user does not.

The five biggest product holes:

1. **[CRITICAL] You cannot enter a tournament.** There is no join/registration endpoint, no participant UI, no deck-selection UI, no check-in UI, no judge-assignment flow anywhere in the plan — despite `TournamentParticipant.deckId`, `checkedIn`, and `Match.judgeId` all existing in the schema.
2. **[CRITICAL] The Auto-Meta Engine (spec §2.E) is named in Phase 5's scope line and implemented nowhere.** No win-rate computation task, no UI surfacing it, despite the spec listing it as a headline feature and the architecture blurb promising "leaderboards."
3. **[CRITICAL] No profile/account management UI exists at all.** Users cannot edit their profile, set privacy levels (the `PATCH /api/profile/privacy` route has no page calling it), manage passkeys/TOTP, or set notification preferences (`notifyRadiusKm`, `notifyRecurring`, `notifyEmail` are schema-only). There is no notification inbox page — notifications are written to the DB and pushed over SSE, but no screen renders them.
4. **[CRITICAL] No top-level navigation or IA decision exists.** The Header renders brand + theme toggle + login (plan line 1596–1610). `MobileNav` is "a fixed bottom bar" with no specified tabs. Six phases of sub-plans will each invent their own navigation, and the fixed route tree contains no `/settings`, no notification surface, and two unexplained event/tournament route pairs.
5. **[IMPORTANT] No shared UI component layer.** Colors and fonts are tokenized, but there is no Button/Input/Card/Badge/Form/Modal/Toast/EmptyState primitive task — five phases of independently written forms and cards will produce a visibly inconsistent product.

Supporting gaps: no onboarding/empty-state story (including the parts-catalog chicken-and-egg), no search of any kind, no rating/comment UI for builds (spec §2.A), no event-creation form, no admin/moderation surface for roles and catalog curation, no legal pages (Impressum/Datenschutz — legally required for a German site), and zero accessibility considerations.

---

## 1. Information Architecture & Navigation

**References:** repo-wide file structure (plan lines 46–118); Task 10 "Responsive App Shell" (lines 1560–1630); Header implementation (lines 1596–1610).

- **[CRITICAL] There is no navigation model — only a route list.** The fixed file structure enumerates routes (`collection`, `decks`, `rules`, `events`, `clubs/[slug]`, `tournaments/[id]`, `profile/[username]`) but the plan never decides how a user moves between them. Task 10's `Header` renders exactly three things: the brand, the theme toggle, and either the username or a Login link (lines 1596–1610). No primary nav, no menus. Task 10 Step 5 says `MobileNav` is a "fixed bottom bar visible only below `md`" — with **zero specified tabs**. This is the single most-used component in a mobile-first PWA and its content is left to each phase's sub-plan to improvise. A master plan that fixes the file tree should also fix the nav model: e.g. bottom tabs [Start/Events, Sammlung, Decks, Clubs, Profil] + header actions (search, notifications bell, theme, avatar menu). Without this, Phase 2 ships nav for rules, Phase 3 re-does it for events, Phase 4 adds clubs, and the result is four different IA decisions stapled together.

- **[CRITICAL] No `/settings` route, and no account surfaces.** The repo tree has `profile/[username]/page.tsx` (a *public* profile view) but nothing for "my account": no profile-edit page (displayName, bio, city, discordTag are schema fields with no UI to change them — register only collects username+password, plan line 759–798), no privacy-settings page (Task 7 Step 5 creates `PATCH /api/profile/privacy` but never says which page calls it), no security-settings page (passkey registration and TOTP setup API routes exist in Task 6 but no page triggers them), no notification-preferences UI (`notifyRadiusKm`/`notifyRecurring`/`notifyEmail` on `User` — set by whom?). Every one of these is a dead API without a screen. Add `app/settings/…` (profile, privacy, security, notifications) to the fixed tree in Phase 1.

- **[CRITICAL] No notification inbox.** Phase 3 builds `GET /api/notifications`, SSE streaming, and the durable `Notification` table — but no page or dropdown renders the list, the unread count, or "mark all read." A notification system whose only consumer is a live SSE toast (and even that UI component is never specified — no `NotificationBell`, no toast component appears in any file list) means a user who misses the live event never sees it. This is a whole feature (spec §2.C: "Automatische In-App Notifications") reduced to an API.

- **[IMPORTANT] `events/[id]` vs `tournaments/[id]` is an unresolved IA duplication.** The fixed tree has both `app/events/[id]/page.tsx` (line 62) and `app/tournaments/[id]/page.tsx` (line 64), and the data model has one entity (`Tournament`) that Phase 3's own scope calls "events." Nothing in the plan says what each page shows, which is canonical, or how they link. An executor will guess — the two guesses will differ across phases. Decide: `/events/[id]` = public event detail (map, info, join CTA, participant list); `/tournaments/[id]` = the competitive surface (bracket, matches, judge entry). State it in the plan.

- **[IMPORTANT] No home/dashboard concept for logged-in users.** `app/page.tsx` is "landing page" (line 50) with no content spec at all — not one word anywhere in the plan about what the landing page contains. For a logged-in user there is no "my next tournament / my clubs' activity / new parts / meta snapshot" home. The landing page is the top of the acquisition funnel for the spec's stated goal ("Einzige und vollständige … Plattform für die gesamte DACH-Region") and it gets no task, no content, no SEO consideration.

- **[NICE-TO-HAVE] No breadcrumbs or section headers specified** for deeper surfaces (club page, deck detail, ruleset view); with six phases of independent sub-plans, wayfinding inside sections will be inconsistent.

---

## 2. Onboarding & First-Run Experience

**References:** Task 5 registration (lines 654–879); Phase 5 Part A (lines 1791–1798); `app/page.tsx` (line 50).

- **[CRITICAL] No path from "new visitor" to "engaged user" is specified anywhere.** What does an anonymous visitor see? Unknown (landing page unspecified). What does a fresh registrant see after signup? Unknown — `app/api/register` returns JSON (line 797); the register page is a "standard controlled-form" (line 872) with no specified post-register destination, no email verification step (email optional, so nothing to verify — fine), no "welcome, do these three things" guidance. The spec's product goal is community growth; the plan's answer to onboarding is literally nothing. Minimum viable fix: after register, land the user on a first-run state of `/decks` or `/collection` with empty-state CTAs ("Erstelle dein erstes Deck", "Trage deine ersten Teile ein", "Finde Turniere in deiner Nähe" — the last one needs the postal-code prompt that also powers `notifyUsersInRadius`, which nothing asks for at signup).

- **[CRITICAL] No empty-state specification exists for any surface.** Concretely:
  - **Empty parts catalog (chicken-and-egg):** Phase 5 Part A adds the `Part` model and "seed data for parts catalog" (line 1792), but the plan never says who maintains the catalog after launch. There is no admin UI to add/edit parts. Real new releases (Beyblade X is a living toy line with frequent releases) would require a code-level seed PR per release — or, worse, user-created parts with no curation story (the spec §2.A demands "Feste Attribute" and TT/Hasbro "Kennzeichnung," i.e. a curated reference DB). This needs a decision: an admin/moderator catalog-management UI (phase it, but name it) plus a "request missing part" flow.
  - **Empty collection** (`/collection` with zero items): no CTA, no explanation of what a collection is for.
  - **Empty decks**: same.
  - **Empty events map** (launch day, DACH-wide, zero tournaments): the first impression of the flagship calendar feature is a blank map and an empty list. A launch-day-without-content plan (seed a few real tournaments, show a "no events yet — create one" CTA for ORGANIZER-role hopefuls) is absent.
  - **Empty club list, empty ruleset list**: same pattern.
  The plan should make "empty state" a standing acceptance item per page, the way the zero-CDN guard is standing (plan lines 1901–1907) — one reusable `EmptyState` component plus a per-page CTA rule.

- **[IMPORTANT] The location prompt is never designed.** Radius search (Phase 3), `notifyUsersInRadius`, and club discovery all depend on the user's `(lat,lng)`/postal code — and no screen ever asks for it. Registration collects username+password only. So the notification radius feature (a spec §2.C headline) is opt-in data that the UI never solicits. Design the ask: a one-line postal-code field on the profile/settings page plus a contextual prompt ("Setze deinen Standort, um Turniere in deiner Nähe zu finden") on the events page.

- **[IMPORTANT] No anonymous-experience definition.** What can a guest do? `/events`, `/rules/[slug]` (public), presumably club pages — but nothing states the guest's view vs. the member's view (e.g. event detail with a "Log in to join" CTA vs. a join button). Each phase sub-plan will decide independently; decide once.

---

## 3. Core User Flows — Walked End-to-End

### (a) Discovering and joining a tournament as a player — **[CRITICAL: cannot be completed]**

Walk: events page → event detail → join → pick deck → check in → play → results.

| Step | Plan coverage | Verdict |
|---|---|---|
| Find events (map/calendar/filters) | Phase 3 full coverage | ✅ |
| Event detail page | `app/events/[id]/page.tsx` exists (line 1746) — content unspecified but present | ⚠️ |
| **Join tournament** | **No `POST /api/tournaments/[id]/join`, no participant registration UI, nothing.** `@@unique([tournamentId, userId])` is added (line 1743) to guard a registration path that doesn't exist | ❌ **MISSING** |
| **Attach a deck (`TournamentParticipant.deckId`)** | **No UI anywhere.** The schema has the FK; the plan never says how or when a player selects which of their decks they're bringing — before join? After join? Editable until check-in? This was flagged in the review brief and the answer is: nothing | ❌ **MISSING** |
| **Check-in (`checkedIn`)** | **No UI, no endpoint.** Field is schema-only | ❌ **MISSING** |
| View bracket / my next match | Phase 5 Part C bracket view (judge-oriented; `JudgeBracketView` is mobile-first but there is no *player*-facing "my next match" surface) | ⚠️ |
| See results | Bracket view doubles as result view — acceptable | ✅ |

This is the platform's **primary journey** (spec project goal: Turnier-Plattform) and the join half of it does not exist. Note the spec §3 model deliberately includes `deckId` + `checkedIn`, so the spec expects this flow; the plan just never builds it. Phase 3's acceptance criteria (lines 1757–1764) test notification radius and authz — not a single player-journey criterion.

### (b) Building a deck and validating it — **[IMPORTANT: partially missing]**

Deck creation, the no-duplicate-parts validator (client + server + DB constraint) are well covered in Part A (lines 1793–1798) — that part is genuinely good. What's missing:

- **[IMPORTANT] No Builds surface at all.** There is no `app/builds/*` route in the fixed tree, no builds list/browse page, no build detail page — yet `components/beyblade/BuildCard.tsx` exists (line 82) with nothing to render it in, and the deck builder presumably needs a "pick or create builds" step that is unspecified. Spec §2.A: "Jede Combo hat eigene Bewertungs-/Kommentarbereiche" — see (f) below: the rating/comment UI and even its API route don't exist. A user can POST `/api/builds` (line 1793) but can never *see* a build except as a card inside a deck.
- **[NICE-TO-HAVE]** Deck builder UX specifics (search/select from parts, type-iconography feedback, validator feedback placement) are unspecified — the phase sub-plan will improvise all interaction design.

### (c) Finding a club and joining — **[MOSTLY WORKS, with gaps]**

- `app/clubs/page.tsx` (list/create) and `app/clubs/[slug]/page.tsx` (home + roster + club tournaments) exist (line 1775); join via `POST /api/clubs/[slug]/members` (line 1776). Flow is coherent. Gaps:
- **[IMPORTANT] Club→event creation is contradictory.** Phase 3 gates `POST /api/tournaments` to `ORGANIZER`/`ADMIN` **role** (line 1747). Phase 4's acceptance criterion (line 1782) says a club owner/admin can create a tournament with `clubId` set. But a club owner is a `ClubMember.isAdmin`, not necessarily a global `ORGANIZER` — so per Phase 3's gate, most club admins **cannot** create their club's events, which is exactly what spec §2.D/§5 Phase 4 promise ("Erstellen von lokalen Vereinen/Clubs mit eigenen Events"). The two phases' rules conflict and neither files list includes a "create event" form UI (see 3e-adjacent gap below). The Phase 3 route must accept "club admin creating for own club" as an authorization path, and the club page needs a "Neues Event" button wired to it.
- **[NICE-TO-HAVE]** No club discovery beyond an alphabetical list (see §8 Search), no club leave/kick UI (`DELETE` on members route isn't in the files list — only POST join and PATCH promote/demote, line 1776).

### (d) Building a collection and tracking value — **[IMPORTANT gaps]**

- Collection page + form + currency conversion + privacy gating are covered (lines 1800–1804). Gaps:
- **[IMPORTANT] "Preisverlauf" from spec §5 Phase 5 is unimplemented.** Spec line: "Sammlungs-Verwaltung mit Mehrwährungsumrechnung (EUR/CHF/USD) und **Preisverlauf**." `CollectionItem` has a single `purchasePrice`; no price-history table, no chart, no task. Either add it (a `PricePoint` table + sparkline) or explicitly descope it and amend the spec mapping.
- **[NICE-TO-HAVE]** No total-collection-value view, no per-part quantities (the model has no `quantity` — owning three copies of one Blade is three rows; acceptable but worth a deliberate note), no "which of my parts are tournament-legal in my deck" tie-in between collection and deck builder — a natural, differentiating feature the plan never considers.

### (e) Creating and sharing a ruleset — **[WORKS]**

The strongest flow in the plan: editor, slug, public view, 404-not-403 privacy, PDF export, per-field round-trip acceptance tests (lines 1719–1734). One gap:
- **[NICE-TO-HAVE]** No browse/discovery affordance beyond the list page (search, "popular this month," formats filter). Acceptable for launch.

### (f) Cross-flow gaps the walk exposed

- **[CRITICAL] No rating/comment UI for builds.** Spec §2.A promises per-combo rating/comment areas. The plan adds `Rating.userId` as a schema fix (line 1797) and then… stops. No `POST /api/builds/[id]/ratings` route, no rating form component, no comment list, no edit/delete-your-own-rating interaction, no moderation surface for a public comment area. The schema fix is correct and useless without the feature.
- **[CRITICAL] No judge/organizer role-assignment flow.** `Role` includes `JUDGE` and `ORGANIZER`; `Match.judgeId` exists; the score route checks `Match.judgeId` (line 1816). But **nothing anywhere assigns these roles** — no admin UI, no application/request flow, no self-serve path. And once a user is somehow a JUDGE, **nothing assigns judges to matches**: the bracket generator emits `Match` rows with `judgeId = null` and no organizer-facing "assign judges" UI exists in `JudgeBracketView`'s parent page. The entire judge flow (covered technically by the other review) is unreachable: judges cannot be designated, matches cannot be assigned. The spec never spells out the assignment mechanism either, so this is an underspecification the plan had to resolve and didn't. Minimum: an admin role-management screen + an organizer "assign judge per match/table" UI in the tournament manager.
- **[CRITICAL] No tournament-creation UI.** Phase 3 files include `POST /api/tournaments` (line 1747) but **no create-event form/page** — no `TournamentForm` component, no `/events/new` route. The same Phase 3 also leaves `isRecurring`/`recurringDays` with no UI. Combined with the missing role-assignment flow, the platform's supply side (people creating events) has no front door at all.
- **[IMPORTANT] No organizer tournament-management dashboard.** There is no UI for: generating the bracket (when? who presses the button?), advancing rounds, re-seeding, recording no-shows, ending the tournament, editing participants. `Match.status` and `round`/`bracketOrder` fields (line 1812) exist for a state machine that has no operator console. The judge UI scores matches; nobody can *run* the tournament.

---

## 4. Auto-Meta Engine (spec §2.E) — **[CRITICAL: spec feature, zero implementation]**

**Spec, verbatim (line 87):** "Auto-Meta Rating: Automatische Berechnung von Win-Rates und Performance-Ratings für Einzelteile und Combos basierend auf Turnier-Ergebnissen."

**Plan:** Phase 5's scope line claims §2.E (line 1789: "Scope: spec §2.A, §2.E, §2.C"). But inside Phase 5:

- Part A (parts/decks): no win-rate task.
- Part B (collection): no win-rate task.
- Part C (tournament/judge): scoring and brackets — but **no task computes any statistic**. No `lib/meta.ts`, no aggregation query, no scheduled/recalculated rating, no `PerformanceRating` model or derived field, no API route serving meta data, no UI component (a "Meta" page, part-level win-rate on `BuildCard`, a leaderboard — nothing). The architecture blurb (line 7) even lists Redis for "leaderboard caching," and the backend review's nice-to-have #21 already noted this promise is unscoped — the fix that landed was none.

Consequences: a headline differentiating feature ("which Blade actually wins tournaments, computed from real DACH results") — arguably the thing that makes a platform-owned tournament circuit *valuable* — ships as nothing. And the data needed is partially stranded anyway: `Match.player1BuildId/player2BuildId` are only filled if players attach decks (see 3a — no UI) and judges record builds per match (judge UI records *scores*; whether the judge picks which build each player used is unspecified — without per-match build linkage, combo-level win-rates are uncomputable even after the fact).

**Fix:** Add to Phase 5 (a natural home is Part C, after scoring works): a `lib/meta.ts` computing part- and build-level win rates from `COMPLETED` matches (denominator policy: minimum N matches before displaying, to avoid 1–0 noise), a recalculation trigger (post-score recompute of affected aggregates, cached in Redis — finally justifying the "leaderboard caching" line), and a UI surface: a `/meta` page and/or win-rate badges on part/build cards. Also specify where per-match build identity comes from (participant's registered deck, or judge confirms at match start). If descoping, amend the plan's own claim that it implements §2.E.

---

## 5. Missing Features vs Spec — Systematic Sweep (§1–§5)

Spec section by section, every concrete promise, and its plan status. Items already covered by the two prior reviews are marked as such and not re-argued.

### Spec §1 (UX/UI, PWA, Design, Privacy, Tech)

| Spec line | Status |
|---|---|
| Farbpalette/Typografie/Typ-Indikatoren (lines 13–22) | ✅ tokens in Phase 1 |
| 100 % Responsive, Theme-Switcher (26–27) | ✅ (judge-screen specifics in other review) |
| PWA manifest/SW/install (31–33) | ✅ (offline depth in other review) |
| 0 % externe Ressourcen, keine Gast-Cookies, anonyme Registrierung, Passkeys/TOTP, OSM-Proxy, granulare Privatsphäre (37–42) | ✅ (per other reviews) — **but see below: privacy/2FA/passkey management UIs missing** |
| Tech-Stack (46–52) | ✅ |

Residual §1 product gaps: the privacy *settings UI* (spec §2.D promises per-field control; the PATCH route has no page), the passkey/TOTP *management UI*, and the profile-edit UI (§2.D lists Display-Name, Alter, Standort, Discord-Tag as user-controlled fields — none editable anywhere in the plan). **[CRITICAL, counted in §1/§2 findings above.]**

### Spec §2.A (Teile-Datenbank)

- "Teile-System: Strikte Trennung … Feste Attribute" — ✅ `Part` model.
- "Hersteller & Varianten: TT/Hasbro … Repaints" — ✅ `manufacturer` field; ⚠️ no UI to *manage* the catalog (who enters new releases?) — **[CRITICAL, see §2]**.
- "Builds (Combos) … **Jede Combo hat eigene Bewertungs-/Kommentarbereiche**" — ❌ **rating/comment UI and API missing entirely [CRITICAL]**; the builds themselves have no pages either.
- "Decks (3on3) … Automatischer Regel-Validator" — ✅ thorough (lines 1793–1798).

### Spec §2.B (Regel-Editor)

- Deck formats, points, modifications (Out-of-Bounds, Own-Finish, Arenaturn, Locked Decks) — ✅ all map to `Ruleset` fields.
- Sonderregeln: "Relaunch … Luftkontakt-Wiederholungsregel" — ✅ (`relaunchLimit`, `aerialContactRerun`).
- "äußere Störungen" (external disturbance rule, spec line 70) — ❌ **no `Ruleset` field or editor control exists for it.** The schema is declared "authoritative" and Global Constraints forbid invented fields, so an implementer *cannot* add it without violating the plan. Either the spec line gets dropped or an additive `externalDisturbanceRerun Boolean @default(true)` (name TBD) must be blessed. **[IMPORTANT]** — small, but it's a spec bullet with no home.
- "/rules/[slug] öffentliches Verlinken + PDF" — ✅.

### Spec §2.C (Turniere/Kalender/Notifications)

- Kalender + Karte + Bundesland/Kanton-Filter, Umkreissuche — ✅.
- "Automatische In-App Notifications (und **optional E-Mail**) bei neuen Turnieren" — ⚠️ **the email half is unimplemented**: `notifyEmail` is read by `lib/notify.ts` (line 1753), but no mail transport exists anywhere — no SMTP env var in `.env.example` (lines 452–461), no mailer library, no send path. The flag is a dead schema column. **[IMPORTANT]** Add a mailer (e.g. `nodemailer` or a self-hosted option consistent with the zero-CDN ethos — note the spec's privacy-first stance makes an external SaaS mailer a decision, not a default) or cut the flag.
- RSS — ✅.
- Judge-Flow — covered by the frontend review (out of scope here).

### Spec §2.D (Social, Profile, Clubs)

- Profil-Sichtbarkeit per field — ✅ mechanism; ❌ settings UI (above).
- "Freundschaftsanfragen verwalten" — ✅ (friend page, request/accept/block).
- "Erstellen von lokalen Vereinen/Clubs mit **eigenen Events und Rollen**" — ⚠️ clubs ✅, roles partially (owner/admin), **club events blocked by the Phase 3 role gate** (see §3c) — **[IMPORTANT]**.
- Implicit promise: users can maintain a profile (displayName, bio, location, Discord) — ❌ no edit UI. **[CRITICAL, above.]**

### Spec §2.E (Sammlung & Auto-Meta)

- Bestandserfassung mit Kaufdatum/Händler/Preis/Multi-Währung — ✅.
- **Auto-Meta Rating — ❌ entirely missing. [CRITICAL, §4 above.]**

### Spec §3 (Schema)

Product-relevant schema observations not from the backend review: `TRUSTED` role is defined and **used by nothing** — no feature, criterion, or UI grants or consumes it. Either give it meaning (e.g. trusted catalog contributors — which would elegantly solve the parts-curation problem) or drop it. **[NICE-TO-HAVE]**

### Spec §4 (Deployment)

Covered exhaustively by the backend review; no product additions.

### Spec §5 (Phase instructions)

- Phase 3 instruction: "Implementiere die Event-Seite mit Leaflet-Karte, Kalender und Umkreissuche" — ✅ plus missing create-event UI (§3f).
- Phase 4: "Club-Modul **inkl. Events im Namen des Clubs**" — ⚠️ gate conflict (§3c).
- Phase 5 instruction verbatim (line 474–475): "Sammlungs-Verwaltung mit Mehrwährungsumrechnung (EUR/CHF/USD) **und Preisverlauf**" — ❌ **Preisverlauf unimplemented** [IMPORTANT, §3d]. "Turniermanager mit Brackets und … Judge-Interface" — ⚠️ judge side covered; **player-side tournament flow (join/deck/check-in) missing** [CRITICAL, §3a]; **organizer console missing** [CRITICAL, §3f].
- Phase 6 — ✅ per backend review.

### Sweep-level extras the spec implies but never says outright

- **[IMPORTANT] No legal pages.** A German-language community platform storing `birthDate`, locations, and (optionally) emails of — realistically — minors needs `Impressum` and `Datenschutzerklärung` pages (DDG/DSGVO). The spec's privacy-first stance makes their absence conspicuous. Nothing in the plan creates them; they must ship before public launch and be linked in the Footer (which exists but whose content is unspecified).
- **[IMPORTANT] No admin/moderation surface at all.** `ADMIN` role exists; there is no admin screen for: role assignment (JUDGE/ORGANIZER/TRUSTED — see §3f), user moderation (ban/reset), catalog curation (see §2), comment/rating moderation (once ratings exist). A community competition platform without operator tooling cannot be operated. At minimum: a minimal admin section (user list + role dropdown; parts CRUD) belongs in the plan, even if deferred to a post-Phase-6 "Phase 7."
- **[NICE-TO-HAVE] Password recovery.** Acknowledged as deferred in the Cross-Phase Guard ("password reset if added later," line 1907), which is honest — but with email optional, accounts are unrecoverable by design, and no UI copy even warns the user ("ohne E-Mail kann dein Passwort nicht zurückgesetzt werden"). At minimum, say it in the register UI.

---

## 6. Visual / Interaction Design Consistency

**References:** tokens (lines 27, 185–209); Task 10 app shell; component lists per phase.

- **[IMPORTANT] No shared component-library task.** The plan tokenizes colors and fonts (Tasks 1–2, 9) and then specifies only feature components: `RulesetForm` (Phase 2), `LeafletMap` (Phase 3), `FriendButton` (Phase 4), `DeckBuilder`/`CollectionItemForm`/`JudgeScorePad` (Phase 5). There is no `components/ui/` layer — no Button, Input, Select, Textarea, Card, Badge (beyond `TypeBadge`, which lands in Phase 5 and is therefore unavailable to Phases 2–4), Modal/Dialog, Toast, Tabs, EmptyState, FormField/Label/ErrorText, Skeleton/loading, or Pagination primitives. Header/Footer/MobileNav exist; nothing they contain is specified either (no menu, no avatar dropdown). Six phases, each writing its own sub-plan, each inventing its own buttons and form patterns on the fly, with different authors (subagents) — the predictable output is a patchwork: Phase 2's editor looks nothing like Phase 5's deck builder. Fix cheaply: add a **Phase 1 Task "UI primitives"** defining `components/ui/*` with a written spec (sizes, states: default/hover/active/disabled/loading/error; focus rings; the form-field pattern with label+error; card padding; empty-state anatomy). Every later phase's file list should be required to consume these. This is the single highest-leverage consistency fix available.

- **[IMPORTANT] No interaction-state guidance anywhere.** Loading states (server components make this partly implicit, but every mutation has a pending state), error surfacing (forms show *what* error? the API returns `{error: 'invalid_username'}` — who maps that to German user-facing copy?), success feedback (toast? inline? redirect?), destructive-action confirms (delete deck, block friend, delete tournament), optimistic updates — none of it is specified. Decide the patterns once in Phase 1 (error-copy map, toast convention, confirm-dialog convention) or each phase will decide differently.

- **[NICE-TO-HAVE]** No iconography convention beyond "use Lucide" (line 486); no spacing/layout grid convention (container widths, page padding, section rhythm); no motion guidance (the theme transition at line 388 is the only animation decision in the whole plan).

- **[NICE-TO-HAVE]** The "Gear Sports" aesthetic (spec line 11: "Extreme Speed / Gear Sports … scharfe Kanten, Hochkontrast-Highlights") is reduced to hex codes. No direction for how the aesthetic expresses itself in components (angled accents? speed-line motifs on cards? type treatments for headings vs. body?). One page of art direction — even a bullet list of do/don'ts — would keep six phases on-style.

---

## 7. Accessibility

**References:** none exist. The string "aria", "WCAG", "accessib", "focus", "contrast", "screen reader" appear nowhere in the 1907-line plan. (The judge pad's touch-target/contrast concerns are covered by the frontend review and excluded here.)

- **[IMPORTANT] The primary accent color fails contrast on light mode.** X-Cyan `#00F0FF` on Base Light `#F8FAFC` computes to roughly **1.5:1** contrast — far below WCAG AA (4.5:1 for text). Yet the Header (line 1603) renders the brand name as `text-x-cyan` — on the default light background that's decorative-at-best, illegible at worst. The plan mandates these exact hex values as untouchable constraints (line 27) with no guidance on *where* they may be used (fills, glows, borders on dark, large graphic elements) vs. where they may not (text). Add a usage rule: X-Cyan is a dark-mode accent and a light-mode *decorative* accent; text accents in light mode need a darkened variant (e.g. a `#0891A5`-class cyan) added as a token. This one line in Global Constraints prevents a systemic accessibility failure across every phase.

- **[IMPORTANT] No accessibility acceptance criteria anywhere.** For a platform whose differentiators are (a) a competition tool used under stress and (b) a general community site, minimum viable criteria should be standing, like the zero-CDN guard: semantic landmarks (header/nav/main/footer — the shell task is the natural owner), labeled form controls (every `RulesetForm`/`CollectionItemForm` field), visible focus indicators (never `outline-none` without replacement — Tailwind makes the bad pattern easy), keyboard operability of interactive components (map filters, bracket view, deck builder pickers), `alt`/accessible names on icon-only buttons (the ThemeToggle at least has an aria-label, line 333 — the only a11y-related line in the plan), `prefers-reduced-motion` respect, and Leaflet map accessibility (keyboard-panable, screen-reader summary of results — the events list next to the map is the accessible counterpart and must not be removed).

- **[IMPORTANT] Language and reading:** `lang` on `<html>` — `public/offline.html` sets `lang="de"` (line 1384) but `app/layout.tsx` is never told to; German UI copy with an English/default `lang` breaks screen-reader pronunciation. Also the app is German-first with zero i18n strategy stated — fine for DACH-only, but say it (and it makes the missing German error-copy map in §6 doubly relevant).

- **[NICE-TO-HAVE]** Form error identification (aria-describedby wiring), toast announcements (aria-live), contrast audit of the four type-badge colors (`#EAB308` gold on white is ~2:1 — badge backgrounds are fine, but check badge-on-white text use), and a one-time axe/Playwright accessibility scan in CI.

---

## 8. Search & Discoverability

**References:** events filters (line 1745); club list (line 1775); friend page (line 1774).

- **[IMPORTANT] There is no search of any kind — for anything.** No parts search (the deck builder needs one: "find Blade 'DranSword'" — unspecified how a user picks parts from a seeded catalog), no builds/combos search, no tournament text search (only country/state/radius filters — "Findet Turniere in München" fails if Munich's events were tagged with the wrong `state`), no club search (only a bare list, line 1775), no ruleset search, and — most damaging for a social platform — **no user search**: there is literally no way to find another user. Friend requests start from `FriendButton` on `profile/[username]` (line 1774), but nothing lets you *get* to a profile except guessing the URL or receiving a link. The friend feature is a social graph with no nodes discoverable. Given the spec's ambition (line 5: "Einzige und vollständige … Plattform für die gesamte DACH-Region"), discoverability is a core product function, not polish.

  Minimum viable fix, phasable: (1) Phase 1 — one shared `components/ui/SearchInput` + a `/search` route skeleton; (2) Phase 3 — events get text search over title/city; (3) Phase 4 — user search (username prefix match) powering friend requests, club search by name/city; (4) Phase 5 — parts search (server-side, prefix + category filter — this is a hard prerequisite for the deck builder anyway and currently unspecified) and builds search. A single search-results page with typed sections beats five per-section searches for consistency.

- **[NICE-TO-HAVE]** SEO/discoverability of the public corpus: public rulesets and events are indexable routes, but no sitemap, no per-page metadata strategy, and the landing page (the acquisition asset) is unspecified. RSS helps events; a sitemap + basic metadata conventions in Phase 1 would make the whole public catalog crawlable.

- **[NICE-TO-HAVE]** "What's new" surfacing: new parts in the catalog, upcoming tournaments near you, trending rulesets — any homepage/dashboard feed that makes the platform feel alive. Entirely absent.

---

## Prioritized Punch List

### CRITICAL — the product doesn't work as a product without these

1. **Tournament participation flow** (§3a): `POST /api/tournaments/[id]/join`, participant list + join CTA on event detail, deck-selection UI for `TournamentParticipant.deckId` (incl. when it's editable), check-in UI/endpoint. Phase 3/5.
2. **Auto-Meta Engine** (§4): win-rate computation from `COMPLETED` matches (part + build level, minimum-denominator policy), recalculation/caching, and a UI surface (`/meta` and/or badges on cards). Plus the per-match build-identity question it depends on. Phase 5. If descoped, delete the §2.E claim from Phase 5's scope line.
3. **Account & settings surfaces** (§1): `app/settings/*` — profile edit, privacy settings (the existing PATCH route's caller), security (passkey + TOTP management), notification preferences. Plus a **notification inbox** page/bell with unread count. Phase 1 (skeleton + routes in the fixed tree) with Phase 3/4 filling content.
4. **Navigation model** (§1): specify `MobileNav` tabs and header contents as part of Task 10; add the missing routes (settings, notifications) to the fixed file tree; resolve `events/[id]` vs `tournaments/[id]`.
5. **Admin/moderation surface** (§3f, §5): role assignment (JUDGE/ORGANIZER/TRUSTED), catalog curation UI, rating/comment moderation. At minimum user-role admin + parts CRUD. Phase 4–5 or an explicit Phase 7.
6. **Rating/comment feature for builds** (§3f, §5): API route, form, list, edit/delete-own, moderation hook. Phase 5 Part A.
7. **Tournament creation & operation UI** (§3f): event-create form (incl. `isRecurring`), organizer dashboard (generate bracket, assign judges to matches, advance/complete matches, edit participants). Phase 3 (create) / Phase 5 Part C (operations). Includes resolving the club-admin-vs-ORGANIZER-role gate conflict so "Events im Namen des Clubs" (spec §2.D) is actually reachable.
8. **Parts catalog ownership** (§2): decision + UI for who adds/edits parts after the Phase 5 seed; a "request missing part" user flow; ties into #5.
9. **Empty states as a standing rule + onboarding path** (§2): reusable `EmptyState` component, per-page CTAs, landing-page content, first-run guidance incl. the postal-code ask.

### IMPORTANT — add before the relevant phase starts

10. **Shared UI primitives** (§6): `components/ui/*` task in Phase 1 (Button, Input, Select, Card, Modal, Toast, Tabs, EmptyState, FormField…); later phases must consume them. Include interaction conventions: error-copy map (German), pending/success feedback, destructive confirms.
11. **Accessibility minimums** (§7): X-Cyan usage rule + a dark-mode-safe text-accent token; standing a11y acceptance items (landmarks, labeled fields, focus visibility, keyboard operability, `lang="de"`); contrast check for type badges.
12. **Search** (§8): parts search (prerequisite for the deck builder), user search (prerequisite for friendships working at all), event text search, club search. Phasable across 3–5, but the shared component belongs in Phase 1.
13. **Preisverlauf** (§3d, spec §5): price-history model + UI, or explicit descope with the spec mapping amended.
14. **E-mail notifications** (§5): mailer choice consistent with the privacy-first constraint, SMTP env wiring, send path for `notifyEmail`, or cut the flag.
15. **"Äußere Störungen" rule field** (§5): bless an additive `Ruleset` field + editor control, or drop the spec bullet deliberately.
16. **Legal pages** (§5): Impressum + Datenschutz before launch; Footer links.
17. **Anonymous-vs-member experience definition** (§2): which CTAs guests see (e.g. "Anmelden um teilzunehmen"), decided once in Phase 1 conventions.

### NICE-TO-HAVE

18. Password-recovery warning copy at registration (accounts unrecoverable without email).
19. Collection value summary, quantity handling, collection↔deck-builder tie-in (§3d).
20. Ruleset browse/discovery filters; "trending" surfaces; sitemap + metadata conventions (§8).
21. Art-direction bullet list for the Gear Sports aesthetic (§6); i18n statement (§7).
22. `TRUSTED` role given a meaning or removed (§5); axe scan in CI (§7); club leave/kick UI (§3c); player-facing "my next match" surface (§3a).

---

## Process Note — how this plan absorbs product review

The plan's own structure explains most of these holes: Phases 2–6 are file/interface/acceptance-criteria specs written by whoever authors each phase's TDD sub-plan, and **acceptance criteria in the master plan test APIs and authz, never user journeys**. The two prior reviews were each folded in as standing acceptance rules (zero-CDN guard, negative-authz rule). The same mechanism works here — add to the Cross-Phase Regression Guard (plan lines 1899–1907):

- every new *feature-area* route ships with its empty state, its guest-state, and its place in `Header`/`MobileNav`;
- every new API route for user data has a corresponding settings/UI surface (no orphan PATCH/POST routes);
- new pages must consume `components/ui/*` primitives;
- a page ships with an a11y checklist (landmark, labels, focus, contrast of accent-on-light).

Without rules like these, each phase sub-plan will re-create this review's findings one phase at a time — correctly implemented, unreachable.
