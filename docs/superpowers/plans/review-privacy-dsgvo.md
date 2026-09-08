# Critical Review: BeybladeX Master Plan — GDPR/DSGVO Compliance & User-Data Protection

**Plan reviewed:** `docs/superpowers/plans/2026-09-08-beybladex-master-plan.md` (1907 lines)
**Spec reviewed:** `BeybladeX.de - Master Projekt Spezifikation.md` (§1 privacy mandates, §2 modules, §3 Prisma schema, §4 deployment)
**Date:** 2026-09-08
**Classification:** CRITICAL (legal/compliance blocker or serious harm-to-minors risk — must fix before any real launch) / IMPORTANT (should fix before the relevant phase ships) / NICE-TO-HAVE
**Disclaimer:** I am not a lawyer. This is an engineering review: it identifies where the plan, as written, fails to support the legal obligations a real DACH launch would trigger, and gives concrete implementations a competent team can actually ship. Before launch, have the final Datenschutzerklärung and the minors concept reviewed by a Fachanwalt für IT-Recht / Datenschutz.

**Framing assumption used throughout:** this product will launch on a public `.de` domain, be operated by an identifiable individual (nicolas@kernic.net, spec §4), and be used by real people — including, with near certainty, children under 16. Beyblade X's real-world audience skews roughly 8–14 (same retail/audience band as classic Beyblade and Pokémon TCG). Every finding below is weighted for that population, pessimistically.

---

## Executive Summary

The plan's *technical* privacy hygiene is genuinely good — zero-CDN with a permanent guard test, server-side OSM proxy, cookieless guests, per-field visibility with an enforced projection function, encrypted TOTP secrets, opt-in (`default(false)`) email notifications. None of that is the problem.

The problem is that the plan treats privacy as a **data-protection-engineering** problem and never as a **data-protection-law** problem. For a platform whose realistic core user is a 12-year-old in Germany:

- **[CRITICAL] There is no age gate, no birthDate collection at registration, and no parental-consent or restricted-mode mechanism anywhere.** GDPR Art. 8 makes a child's self-consent invalid below the member-state threshold (16 in Germany, 14 in Austria; Switzerland's revised FADP has no fixed age but presumes capacity of judgment around 14). The registration flow (Phase 1 Task 5, plan lines 759–799) never asks, never stores, never restricts. The platform would be processing children's data without a valid legal basis from day one.
- **[CRITICAL] There is no Datenschutzerklärung, no Impressum, no AGB/Nutzungsbedingungen, and no consent-to-privacy-policy step in registration.** Not one task in any of the 6 phases. The Impressum alone is a statutory requirement (DDG § 5) for any German-operated website offered to the public — it is not optional and not GDPR-dependent.
- **[CRITICAL] There is no account-deletion flow and no data-export flow anywhere.** GDPR Art. 17 (erasure) and Art. 20 (portability) are unconditional obligations; for a platform holding minors' data, an erasure request is a *when*, not an *if*. The prior backend review examined Prisma `onDelete` behavior only as referential integrity (its punch-list item 18); it never asked "can this user actually be erased, in full, on request?" — and under the schema's defaults the honest answer is *no*.
- **[CRITICAL] Location defaults are backwards for this audience.** `locationVisibility @default(PUBLIC)` (spec §3, `User` model) means a new user's city/region is visible to every stranger by default, for a platform whose realistic new user is a child. This contradicts GDPR Art. 25 (data protection by default) in a way that creates real-world harm potential (stranger → child contact channel via profile + Discord tag).
- **[IMPORTANT] No retention policy, no admin audit trail, no breach-response plan, and the email-notification feature (`notifyEmail`, spec §3) has no specified provider or mechanism** — a latent unvetted-third-party-processor risk.

The good news: almost all of this is cheap to add to the *plan* now (Phase 1 mostly), and most of it is additive schema + 2–3 new routes + static pages. Section 10 is a prioritized punch list.

---

## 1. Minors / Age of Digital Consent (GDPR Art. 8) — **CRITICAL**

**What the plan has:** `User.birthDate DateTime?` (spec §3, line 149 of the spec, copied verbatim into the schema in Phase 1 Task 3). That is *all*. The registration route (plan lines 773–798) accepts `{ username, password, email? }` and nothing else. No registration-page field for age, no age check, no consent flag, no parental-consent flow, no restricted mode, no minor-specific behavior anywhere in any phase. `resolveVisibleFields` (plan lines 1271–1286) is age-blind — it cannot treat minors differently because nothing ever marks a user as a minor. The only age-adjacent work in the whole plan is `ageVisibility` defaulting to PRIVATE (plan line 1201), which is good but irrelevant if `birthDate` is never populated.

**Why this is a blocker:** Under GDPR Art. 8(1), where the legal basis is consent (or where the service is "offered directly to a child"), the child's own consent is valid only at/above the age the member state sets — between 13 and 16. Germany set **16** (via the German implementation provisions), Austria set **14**, Switzerland's revised FADP (in force since 2023) sets no numeric age but relies on capacity of judgment (in practice ~14). The platform's realistic audience is 8–14. Concretely: a large fraction of BeybladeX.de's actual users will be children whose consent to processing is **legally void**, meaning every processing operation (account, location, decks, match history, notifications) runs without a valid legal basis — abmahn- and fine-exposure territory (Art. 83(5): up to €20M/4%), and reputationally catastrophic for a children's hobby platform.

**Minimum viable fix (what a competent team should actually build):**

1. **Collect date of birth at registration** (not just year — the spec's "Alter" display feature wants a real birthDate anyway, and it's already in the schema). Add it to the register route and form in Phase 1 Task 5.
2. **Compute `isMinor` server-side** at registration and on each login (age drifts; derive it, don't store a stale boolean — or store a `dateOfBirthVerifiedAt`-style timestamp only if needed). Additive helper in `lib/privacy.ts`.
3. **For users below the German threshold (16 — the highest in DACH and the operator's apparent home jurisdiction), pick one of two implementable models:**
   - **(a) Parental-consent gate:** registration below 16 completes only after a parent/guardian confirms via a one-time link sent to the parent email collected at registration (this finally gives the optional email field a purpose — the *parent's* email). Store `parentalConsentAt DateTime?` + `parentalConsentEmail String?` (additive fields). The minor's account stays in "pending" state until confirmed. This is the Art. 8-compliant version and is the right answer if the operator wants under-16s at all.
   - **(b) 16+ age gate (honesty-based):** registration simply refuses birthdates indicating age < 16, with a clear, friendly message. This is what a large share of German community sites pragmatically do. It is weaker (kids lie about age; you must then not knowingly retain discovered underage accounts — add a "report underage user" mechanism and a deletion path for confirmed cases), but it is a real, implemented position instead of the current nothing.
   Model (a) is the legally clean answer for a platform that expects minors; model (b) is defensible for a platform that doesn't. The current plan implements neither and cannot be launched as-is.
4. **Minor-restricted defaults, enforced server-side.** Whatever the age model, any account identified as a minor must get, *not merely as UI defaults but as hard ceilings in `resolveVisibleFields`*: location fields never visible beyond FRIENDS_ONLY (ideally PRIVATE), `discordTag` hidden from strangers (external contact channel to a child — treat it like location), no public bio, and no email notifications. Implement as a first check inside `resolveVisibleFields` (and the Phase 3 notification path), not as a client-side hint.
5. **Document the age model in the Datenschutzerklärung and the registration flow** ("Mit der Registrierung bestätigst du, dass du mindestens 16 Jahre alt bist …").

**Effort:** mostly Phase 1 Task 5 (form + route + tests) and a `lib/privacy.ts` extension; additive schema fields per model (a). This is days, not weeks — which is exactly why its absence is inexcusable at launch.

---

## 2. Legal-Basis Surface: Privacy Policy, Impressum, AGB, Consent Record — **CRITICAL**

**What the plan has:** nothing. A full-text search of the plan for Impressum / Datenschutz / privacy policy / AGB / Nutzungsbedingungen / consent returns zero hits. The spec's §1 "Datenschutz & Privacy-First" section (spec lines 35–42) is entirely *technical* (no CDNs, no guest cookies, anonymous registration) — it never mentions legal documents either. The Footer (Phase 1 Task 10, plan line 1618) is the natural home and is never given any legal links.

**Why this is a blocker:**

- **Impressum:** § 5 DDG (formerly TMG) requires essentially any German-operated website offered to the public to publish the operator's identity and contact data. This applies regardless of GDPR, regardless of commerciality in most practical readings (an "geschäftsmäßig" operated Online-Dienst — a continuously operated community platform with user accounts qualifies; even where a private-operator edge case might be argued, an Impressum costs nothing and its absence is the single most-abmahn'd item in German web law).
- **Datenschutzerklärung (privacy policy):** Art. 13/14 require informing data subjects at collection time: controller identity, purposes, legal bases, retention, recipients (OSM tile fetch, FX API, email provider if any), all data-subject rights, complaint right to the supervisory authority (for DE: Landesdatenschutzbehörde). None of this exists as a surface.
- **AGB/Nutzungsbedingungen:** not strictly mandated by data-protection law, but a community platform with UGC (ratings, comments, club descriptions, bios) needs the contractual basis for moderation, content removal, and account termination. Important adjacent to this review; treat as launch-blocking in practice because the moderation powers in later phases have no legal hook without it.
- **Session-cookie disclosure:** the cookieless-guest design is excellent and — correctly — needs **no consent banner**: the session cookie is strictly necessary for the requested service (TTDSG § 25(2) now TDDDG § 25(2)), and the theme preference is localStorage-only, no server processing. But "no banner needed" ≠ "no disclosure needed": the privacy policy must still name the session cookie, its purpose, and its attributes (HttpOnly/SameSite=Strict/Secure — all already correctly set at plan line 815). **Decision to document in the plan:** no consent banner at launch; revisit only if any non-essential cookie/analytics is ever added (make that a standing regression note next to the cookie-audit guard, plan line 1903).
- **Consent record:** registration must include a required, unticked-by-default checkbox accepting the Datenschutzerklärung (and AGB). Store the acceptance: additive `privacyPolicyAcceptedAt DateTime?` (+ optionally policy version string) on `User`. This timestamp is your evidence if consent is ever challenged — without it you cannot demonstrate *anyone* agreed to *anything*.

**Minimum viable fix (add to Phase 1):** static pages `/impressum`, `/datenschutz`, `/agb` (German-language content; task the operator to write them, or generate drafts as a follow-up deliverable — but the *routes and footer links* belong in Phase 1 Task 10); the consent checkbox in Task 5's register form + route; the two additive schema fields; a migration. Add "all legal pages reachable in ≤ 2 clicks from any page" and "register without checkbox → 400" to acceptance tests.

---

## 3. Data Subject Rights (Art. 15–21): Erasure, Portability, Rectification — **CRITICAL**

**(a) Erasure (Art. 17) — CRITICAL.** There is no account-deletion flow anywhere in the plan: no settings page (no settings page *exists at all* — see (c)), no `DELETE /api/account`, no mention of deletion in any acceptance criterion. Test cleanup code deletes users directly via Prisma (e.g., plan lines 737, 750, 1029) — which works for freshly created test users precisely because they own nothing; it silently demonstrates that the plan never considered deleting a *real* user with data.

The prior backend review flagged "cascade/delete behavior is unspecified" (its §1, punch-list item 18: "deliberate, documented onDelete matrix") — but exclusively from a **referential-integrity** angle ("delete hard-fails", "leaves undeletable decks"). It never examined it from the **erasure-obligation** angle, and the distinction matters, because the integrity-optimal defaults are the erasure-worst ones:

- `Club.owner` (spec §3): no `onDelete` → Prisma default `Restrict`. A user who owns a club **cannot be deleted**.
- `Ruleset.createdBy`: same → **cannot be deleted**.
- `TournamentParticipant.user`, `Deck.user`, `Match.judge`, `Rating.build` (once the Phase 5 additive `Rating.userId` lands): Restrict or unsettled.
- `Match.player1Id/player2Id/winnerId` are bare strings — even an anonymization pass has nothing to cascade through; orphaned pseudonymous references persist.

Under Art. 17, "the database won't let me delete this user" is not a defense, and neither is "deleting them corrupts tournament history." The standard engineering answer, and what the plan must specify:

1. `DELETE /api/account` (authenticated, password/TOTP re-confirmation) in a new Phase 1 task or early Phase 4 alongside the settings surface.
2. **Anonymization, not deletion, for competitive-integrity data:** tournament results are the legitimate interest of *other* data subjects (opponents' records, club history). Replace the departing user's personal columns with nulls/`"gelöschter Nutzer"` (`username` must be released — it's `@unique`), reassign or dissolve clubs (`Club.ownerId` → another admin member or delete club), reassign `Ruleset.createdById` to a system/ghost user, and keep `Match.player1Id` as an opaque anonymized reference (or a `deletedUserId` sentinel) with the personal link severed. Document explicitly that match results survive as anonymized data — this is the Art. 17(3)(b) "freedom of expression/information + legal claims" style carve-out and should be a stated decision, not an accident.
3. The documented onDelete matrix (backend-review item 18) must be extended with this erasure column: every relation involving `User` gets an explicit decision — `Cascade` (notifications, passkeys, friendships, club memberships, collection, decks, ratings), `Restrict`-plus-anonymization-step (club ownership, rulesets, judged matches, participations).
4. **Session invalidation on deletion:** JWT sessions live 30 days (plan line 812) with the token-revocation story still open (backend-review item 7). A deleted account whose JWT still works for 30 days is an Art. 17 failure in practice. Whatever revocation mechanism the plan eventually picks (`tokenVersion` or allowlist), account deletion must trigger it; state that in the deletion task.

**(b) Portability (Art. 20) — IMPORTANT.** No data export exists or is planned (grep: no "export my data", no JSON download endpoint; the only "export" in the plan is the ruleset PDF). Spec-compliant minimum: `GET /api/account/export` returning a JSON document of everything the user provided (profile fields, collection incl. purchase data, decks/builds, ratings, friendships, club memberships, notification preferences) plus a machine-readable list of their tournaments/matches. This is genuinely easy — one route assembling Prisma queries — and should ride along with the deletion task. CSV-instead-of-JSON is acceptable for the collection (price-history use case); JSON for the rest.

**(c) Rectification (Art. 16) — IMPORTANT.** There is no profile *edit* capability planned anywhere: Phase 1 Task 7 wires a read-only profile page and a privacy-settings `PATCH` (plan line 1296 — which, incidentally, still says "updates the four visibility enum fields" even though the task itself added a fifth, `ageVisibility`; a one-line inconsistency to fix while touching the file). No route or page exists to edit `displayName`, `bio`, `city`, `postalCode`, `country/state`, `discordTag`, `birthDate`, or notification preferences. Users cannot correct their own data — an unconditional Art. 16 gap. Fix: `app/profile/edit/page.tsx` + `PATCH /api/profile` (owner-only, field whitelist, `birthDate` edits re-run the age check from §1 — a minor aging into majority must unlock, a bogus age correction demoting an adult to "minor" must trigger re-verification), plus notification-preference toggles (which also finally give `notifyRadiusKm`/`notifyRecurring`/`notifyEmail` a UI — they currently have none).

---

## 4. Data Minimization (Art. 5(1)(c)) — **IMPORTANT**

The registration flow itself is admirably lean — username + password, email optional, no phone, no real-name field, no third-party sign-in. That is the right call and should be stated as a *constraint preserved in every future phase* (e.g., never let OAuth providers sneak in later as a "convenience").

The gaps are elsewhere:

- **`User.latitude/longitude` (spec §3):** stored per-user to power `notifyUsersInRadius` (plan line 1753). Precise coordinates of (likely minor) users, persisted indefinitely, for a feature that conceptually needs only "postal-code centroid + radius." The plan never states when these get set (no task writes them — another underspecification), who can read them (nothing in `resolveVisibleFields` exposes lat/lng directly, which is good, but nothing *forbids* a future call site from returning them either — pin that down), or how precise they are. Minimum fix: derive them **only** from the user's postal code via the already-planned server-side `geocodePostalCode` (plan line 1749) — never from device geolocation — store the centroid rounded to ~2 decimals (≈1 km precision, plenty for a 50 km radius), delete them when the user clears their location, and state all three rules in the plan.
- **`User.birthDate`:** currently collected nowhere and used nowhere (see §1). Once the §1 age gate exists it earns its keep; until then it's dead schema. Also decide its *retention/visibility story*: it exists for the age gate and the "Alter" display — consider storing only month/year of birth plus a computed registration-time age verdict if full date isn't needed for display, or at minimum re-confirm that `ageVisibility @default(PRIVATE)` (plan line 1201) plus the §1 minor ceilings keep it out of strangers' reach.
- **`User.state`/`postalCode`:** needed for DACH filtering; fine, but they ride the same visibility rail as `city` and inherit the §7 default problem.
- **Everything else (deck contents, collection incl. purchase price/merchant, match history, club memberships) is purpose-bound to a feature the user explicitly uses** — no over-collection there.

---

## 5. Retention & Deletion of Stale Data (Art. 5(1)(e)) — **IMPORTANT**

The plan has exactly one retention story: Redis TTLs (tile cache 14 days, rate-limit keys, WebAuthn challenges 120 s) — all fine. Postgres retention is unbounded everywhere:

- **`Notification` rows:** grow forever per user. No pruning task, no "delete read notifications after N days," nothing. Minimum: a documented retention rule (e.g., read notifications purged after 90 days, unread after 12 months) implemented as part of the Phase 3 sub-plan — a single scheduled cleanup path, which conveniently forces the plan to answer the "single container, no cron" question the FX scheduler already had to answer (plan line 1803 — same host mechanism can run the cleanup).
- **Inactive accounts:** no inactivity policy. Add: after ~24 months of no login, email the account (if email known) warning of impending deletion, then anonymize-and-delete per the §3(a) machinery. For a children's platform this doubles as a hygiene win (dead accounts of kids who've moved on).
- **Finished tournaments/matches:** legitimately long-lived (sporting record), but state that and lean on the §3(a) anonymization rail so "kept forever" never means "keeps personal data forever."
- **Rate-limit keys / tile cache / challenges:** already TTL'd — no action.

Also: write the actual retention periods into the Datenschutzerklärung (§2), since Art. 13(2)(a) requires stating them.

---

## 6. Third-Party Processors & International Transfer (Art. 28, 44–49) — **IMPORTANT**

The zero-external-CDN architecture is carried through consistently and is the single best GDPR property of this design: the permanent guard test (plan lines 1497–1528) makes it a standing invariant, the OSM tile proxy keeps users' browsers from ever touching a third-party host, and `lib/geo.ts` geocodes server-side with Redis caching so "no per-request external geocoding call leaks user IP patterns" (plan line 1749). Confirmed carried through — no finding here on the browser side.

The three server-side egress points need one documented paragraph each in the privacy policy, and one needs a decision *now*:

- **OSM tile fetch (plan lines 597–606):** server-side `fetch` to `*.tile.openstreetmap.org`, transmitting the *server's* IP and a contact User-Agent — no user personal data leaves the system. Non-issue for transfer law; disclose the relationship in the policy and keep the ODbL attribution note (already covered, plan lines 638, 1744).
- **FX rate fetch (plan line 1803):** an *unnamed* external FX API, called server-side on cache miss, transmitting no personal data (rate requests carry no user context). Low risk — but "unnamed" is the problem: the plan must fix the provider (a no-key public source like the ECB euro reference rates is ideal for EUR-based EUR/CHF/USD and removes API-credential handling entirely), document it, and confirm no request ever includes user-identifying parameters. If a keyed provider is chosen, the key joins the env-var family from the compose-secrets amendment (plan line 30).
- **Email notifications (`notifyEmail`, spec §3; `notifyUsersInRadius` "respects notifyEmail", plan line 1753):** **this is the one real processor decision, and the plan makes it without noticing.** The schema has an opt-in email flag, Phase 3 has email "notifications," and yet *no email-sending mechanism, provider, or infrastructure exists anywhere in the plan* — no SMTP host, no transactional-email provider, no env vars, no tasks. The realistic failure mode is that a Phase 3 executor "just adds" Resend/SendGrid/Postmark ad hoc, importing an unvetted US-based processor (SCCs/DPA needed, Art. 44 transfer) two days before that phase ships. Fix in the Phase 3 sub-plan (mandatory): either (a) specify an EU-hosted SMTP provider (e.g., the operator's existing mail host at kernic.net, or a German transactional provider) with a DPA and document the transfer analysis, or (b) descope email from Phase 3 and drop `notifyEmail` from the schema until it has a provider — in-app notifications + RSS already cover the spec's core. Do not let it remain an implicit someday-feature with a live schema flag.

---

## 7. Location Data & Privacy-by-Default (Art. 25) — **CRITICAL**

**What the schema defaults to:** `profileVisibility`, `locationVisibility`, `collectionVisibility`, `decksVisibility` all `@default(PUBLIC)` (spec §3 lines 159–162), and `notifyRadiusKm @default(50)` with `notifyRecurring @default(true)` (lines 164–166).

**Why this is the worst single default set for this audience:** a new user — realistically a 12-year-old — gets, with zero action: public city + region (`resolveVisibleFields` exposes `city` to strangers whenever `locationVisibility` is PUBLIC, plan line 1281), public display name, and by extension a public profile page pairing a child's nickname with their hometown, plus an optional `discordTag` — a direct out-of-platform contact channel — riding the same PUBLIC default (plan line 1279, gated only by `profileVisibility`). Nothing in the plan treats location as the high-risk datum it is when the subject pool is minors; nothing implements Art. 25's "by default, only personal data which are necessary for each specific purpose" — a 50 km notification radius is arguably not even an opt-out the user asked for (`notifyRecurring` defaults *on*).

Note the nuance in the plan's favor: precise `latitude/longitude` are *not* exposed by `resolveVisibleFields` (only `city`), and the public-vs-friends distinction is real. The exposure is city-level, not address-level. That keeps this at "serious" rather than "catastrophic" — but for children, city + nickname + Discord tag + club memberships is enough to make a parent rightfully angry and a Datenschutzaufsicht interested.

**Minimum fix:**
1. `locationVisibility @default(FRIENDS_ONLY)` (schema default change — do it in the Phase 1 Task 3 migration *before* any real user exists; changing a default later is a data migration, changing it now is free).
2. Minor ceiling per §1.4: for any account flagged as a minor, `resolveVisibleFields` force-returns `null` for `city`, `discordTag`, and `bio` regardless of the user's own settings, and the notification path skips email entirely. Hard rule in the projection function, tested — not a UI suggestion.
3. Flip `notifyRecurring @default(false)` (opt-in, matching the already-correct `notifyEmail @default(false)`) or at minimum prompt explicitly on first use.
4. State in the registration UX and privacy policy that location defaults are conservative and why.

(`profileVisibility`/`collectionVisibility`/`decksVisibility` PUBLIC defaults are defensible for an adult community platform — usernames are inherently public — and may stay, subject to the minor ceilings.)

---

## 8. Audit Logging & Breach Readiness (Art. 32, 33) — **IMPORTANT**

- **No audit trail exists or is planned.** Privileged roles (ADMIN, ORGANIZER, JUDGE, TRUSTED) act on other users' data — judging matches (plan line 1816), promoting/demoting club members (line 1776), tournament edit/delete (line 1748), and (once some mechanism exists) role assignment itself — **note the plan contains no role-assignment or role-elevation mechanism at all**; how a user becomes JUDGE/ADMIN is unspecified, which for a minors platform is itself worth flagging to the operator. Under Art. 32 and plain operational sanity, every privileged mutation of another user's data should write an append-only `AuditLog` row (actor, action, target, timestamp, before/after summary). Additive `AuditLog` model + writes in the ~6 privileged routes; cheap, and it is the only way to answer "which admin changed this child's profile?" Minimum scope: role changes, account deletions/anonymizations (§3a), tournament deletion, judge-score overrides, club member removal.
- **No breach-response plan.** Art. 33 imposes a 72-hour notification duty to the supervisory authority on the controller (the operator, personally — one individual on kernic.net) when a breach risks users' rights. This does not require software, but the plan should ship an operational runbook page (what counts as a breach for this stack: DB dump, `TOTP_ENCRYPTION_KEY` exposure, host compromise; who decides; the Landesdatenschutzbehörde contact; user-notification templates in German). Also missing and adjacent: a lightweight **DPIA (Art. 35)** — processing children's data + geolocation + public profiles is close to the Art. 35(3)(b) mandatory-DPIA case ("large-scale processing of special categories… or of personal data relating to criminal convictions" — children per se aren't Art. 9, but several DPAs treat systematic children's-data processing as DPIA-triggering). A 3-page DPIA written before launch is proportionate; add it as a Phase 6 pre-launch deliverable alongside the Impressum content.

---

## 9. Special Category Data (Art. 9) — **no finding (confirmed)**

Nothing collected or derived is Art. 9 data: no health, no beliefs, no biometric templates. Passkey public keys are cryptographic credentials, not biometric data (the biometric, where present, never leaves the authenticator — WebAuthn's privacy properties are a genuine plus here, worth one line in the privacy policy). `bio` is free text a user *could* volunteer something sensitive into — mitigation is a content flag/report mechanism plus a profile-field length cap, both cheap and both unplanned; Nice-to-have. Location data deserves its strict handling (§7) but is *not* special-category under the final GDPR text — the plan's obligations there come from Art. 25 and the minors analysis, not Art. 9. `discordTag` is a pseudonymous identifier, not special category, but is treated as sensitive in this review (§7) because it is an out-of-platform contact channel to children.

---

## 10. Prioritized Punch List

### CRITICAL — fix before any real launch (several belong in Phase 1, before its registration flow ships)

1. **Age gate + minors concept (§1):** collect `birthDate` at registration; below the relevant threshold, implement parental consent (preferred, additive `parentalConsentAt`/`parentalConsentEmail`) or a 16+ gate with an underage-report+delete path. Hard-coded minor ceilings in `resolveVisibleFields` (no public city/Discord/bio, no email). Plan: Phase 1 Task 5 + Task 7.
2. **Legal surface (§2):** `/impressum`, `/datenschutz`, `/agb` pages + footer links (Phase 1 Task 10); required, unticked consent checkbox at registration storing `privacyPolicyAcceptedAt` (+ version); document the "no consent banner; session cookie is strictly-necessary" decision next to the cookie-audit guard.
3. **Account deletion (§3a):** `DELETE /api/account` + settings surface + documented erasure matrix (Cascade vs. anonymize-and-sever per relation) extending backend-review item 18; session/token invalidation on deletion. Plan: new task alongside Phase 4's settings work at the latest, earlier is better.
4. **Location-by-default (§7):** `locationVisibility @default(FRIENDS_ONLY)` and `notifyRecurring @default(false)` in the Phase 1 migration; minor ceilings as in #1.

### IMPORTANT — fix before the relevant phase ships

5. **Data export (§3b):** `GET /api/account/export` JSON (CSV optional for collection) — ship with the deletion task.
6. **Rectification (§3c):** profile-edit page + `PATCH /api/profile` with field whitelist and age re-check on `birthDate` edits; notification-preference UI; fix the "four visibility enum fields" stale line at plan line 1296 (it's five now).
7. **Retention (§5):** notification pruning + inactive-account lifecycle, reusing the scheduler mechanism chosen for the FX fetch; publish retention periods in the Datenschutzerklärung.
8. **Email processor decision (§6):** name an EU provider + DPA in the Phase 3 sub-plan, or descope `notifyEmail` from the schema until it has one. Name the FX source (ECB reference rates recommended) and document both egresses in the privacy policy.
9. **Audit log + breach runbook + DPIA (§8):** additive `AuditLog` model on privileged mutations; Art. 33 runbook and Art. 35 DPIA as Phase 6 pre-launch deliverables; specify the role-elevation mechanism (currently absent from the entire plan) and audit it first.

### NICE-TO-HAVE

10. Store only month/year of birth if the age-display feature doesn't need day precision (§4).
11. Round stored user coordinates to ~1 km and derive exclusively from postal-code centroid; delete on location clear (§4).
12. Bio length cap + report mechanism (§9).
13. Verarbeitungsverzeichnis (Art. 30) — a one-page record of processing activities maintained with the privacy policy.

---

## What's genuinely good (keep it)

For balance, so the fixes above don't read as a demolition: the zero-CDN invariant with its permanent guard test, the server-side OSM proxy with politeness User-Agent, cookieless guests with explicit DoD assertion, opt-in notification/email flags in the schema, encrypted TOTP at rest with login-time gating, per-field projection privacy with fixed `isFriend` semantics and BLOCKED handling, 404-not-403 on privacy-gated resources, and the rate-limiting design are all *better* than what most production DACH platforms ship. The gap is not engineering taste — it is that six legal surfaces (age, policy documents, deletion, export, retention, breach readiness) were never in scope for any phase. All six fit inside existing phases with additive changes only; none requires re-architecting anything.
