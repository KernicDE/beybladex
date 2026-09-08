# Phase 2 Sub-Plan: Regel-Editor & Rules Sharing

> Implements the master plan's "Phase 2: Regel-Editor & Rules Sharing" section
> (`2026-09-08-beybladex-master-plan.md`) at file/acceptance granularity. Written after
> Phase 1 completed, against the actual Phase 1 file layout.

**Scope:** spec §2.B. Visual editor for `Ruleset` (deck format, points, penalties, special
rules), public `/rules/[slug]` view, server-side PDF export.

## Schema change (additive, per Global Constraints)

- `Ruleset.externalDisturbanceRerun Boolean @default(true)` — closes the gap between
  spec §2.B ("äußere Störungen" → rematch) and spec §3's schema, which never gave the rule
  a column. `[REVIEW-FIX: ux-product §5]`
- Migration generated the no-live-DB way: scratch copy of the old datamodel +
  `prisma migrate diff --from-schema-datamodel <scratch> --to-schema-datamodel prisma/schema.prisma --script`.

## Files

- Create: `lib/slug.ts` — pure `slugify(title)` (URL-safe, deterministic, German
  umlaut transliteration ä→ae ö→oe ü→ue ß→ss) and `uniqueSlug(base, isTaken)` (collision →
  `-2`, `-3`, …). The pure string transform is unit-testable without a DB; the route injects
  the DB lookup as the `isTaken` callback.
- Create: `lib/rulesetLabels.ts` — German labels for every `Ruleset` field (deck-format
  values, point fields, boolean toggles), shared by the view page, the PDF, and the form.
- Create: `app/api/rulesets/route.ts` — `POST` create. **Authz: session required (401
  otherwise); `createdById` always taken from the session, never the body.** Rate-limited
  (`rulesets:create:{userId}`, 20/h). Slug generated from title, collision-suffixed.
- Create: `app/api/rulesets/[slug]/route.ts` — `GET` (public if `isPublic`, else
  owner-only; **404, not 403, for non-owners on private rulesets** — existence is not
  leaked) and `PATCH` (**authz: only `createdById`; everyone else gets 403** — a private
  ruleset's owner is authenticated by definition, so 403 is safe here where 404 would be
  required for anonymity; negative test proves it). Whitelisted fields only; slug is
  immutable (title edits don't move the URL).
- Create: `components/rules/RulesetForm.tsx` — client form covering every `Ruleset`
  column: title, description, isPublic, deckFormat select
  (`WBO_COUNTERDECK | THREE_ON_THREE | PICK_THREE_CHOOSE_ONE | ONE_ON_ONE`),
  targetPoints/finalsTargetPoints numbers, toggles lockedDecks / allowForceSwitch /
  arenaTurnAllowed / outOfBounds2Pts / ownFinishPenalty / aerialContactRerun /
  externalDisturbanceRerun, relaunchLimit number. Composed from `components/ui/*`
  (FormField + Input/Select/Textarea/Button) — no hand-rolled primitive clones, no
  invented fields. Create mode POSTs to `/api/rulesets` and redirects to
  `/rules/<slug>`; edit mode PATCHes `/api/rulesets/<slug>`.
- Create: `app/rules/page.tsx` — public list of public rulesets (plus the viewer's own
  private ones when logged in). `take`/`cursor` pagination per the standing performance
  convention. `EmptyState` when none; "Neues Regelwerk" CTA for logged-in users (guests
  get the "Anmelden, um fortzufahren" convention).
- Create: `app/rules/new/page.tsx` — create entry, auth required (redirect to /login).
- Create: `app/rules/[slug]/page.tsx` — public view, anonymous-readable when
  `isPublic = true`; `notFound()` (404, NOT 403) for private rulesets the viewer doesn't
  own. `export const revalidate = 300` per `[REVIEW-FIX: performance P16]` (the auth() call
  for the owner-only edit affordance renders it effectively dynamic — the directive
  documents and pins the caching intent for the public surface). Every rule field in
  readable German + link to the PDF export.
- Create: `app/rules/[slug]/edit/page.tsx` — owner-only editor; non-owners redirect to
  `/rules/[slug]`.
- Create: `lib/rulesetPdf.ts` + `app/rules/[slug]/pdf/route.ts` — server-side PDF via
  `@react-pdf/renderer` (npm-bundled, never a client-side/CDN PDF library). Streams
  `content-type: application/pdf` with every rule field in German; same public/private
  visibility as the view page (404 for a private ruleset the viewer doesn't own).

## Validation contract (routes)

- title: string, 1–100 chars (POST required, PATCH optional)
- description: string ≤ 1000 or null
- isPublic / all boolean toggles: actual booleans (rejected otherwise, not truthy-cast)
- deckFormat: one of the four enum values
- targetPoints / finalsTargetPoints: integers 1–100
- relaunchLimit: integer 0–10
- Error codes added to `lib/errorCopy.ts` in the same commit: `invalid_title`,
  `invalid_description`, `invalid_deck_format`, `invalid_points`, `invalid_relaunch_limit`.

## Standing-constraint compliance

- **Negative authz test** for every state-changing route (Global Constraints): PATCH by
  non-owner → 403, covered in `ruleset-crud.test.ts`.
- **404-not-403** for private-resource visibility, same policy as Phase 3+ collection rules.
- **Minor ceilings / erasure matrix**: `Ruleset` is already in Task 12's erasure matrix
  (reassigned to the `geloeschte-nutzer` system user on account deletion) and the new field
  is a plain Boolean — no erasure/export change needed; the round-trip test re-verifies
  reassignment still works via the existing `account-deletion.test.ts`.
- **Test fixtures** use `Date.now().toString(36)` for unique usernames/titles/slugs.
- **No local Docker**: unit tests + `tsc --noEmit` + `npm run build` locally; integration
  tests are CI-only (`npm run test:all`).

## Acceptance tests

- `tests/unit/ruleset-slug.test.ts` — slugify: URL-safe, deterministic, umlaut
  transliteration, empty fallback; uniqueSlug: no collision → base, collision → `-2`,
  `-3`, … (in-memory `isTaken`).
- `tests/integration/ruleset-crud.test.ts` — POST create returns slug + persists
  `createdById` from the session; duplicate title → `-2` slug; PATCH by owner round-trips
  **all** modifier fields (deckFormat, targetPoints, finalsTargetPoints, lockedDecks,
  allowForceSwitch, arenaTurnAllowed, outOfBounds2Pts, ownFinishPenalty, relaunchLimit,
  aerialContactRerun, externalDisturbanceRerun) without loss; PATCH by non-owner → 403;
  GET private by non-owner/anonymous → 404 (not 403); GET public by anonymous → 200;
  unauthenticated POST → 401; invalid deckFormat → 400.
- `tests/integration/ruleset-pdf.test.ts` — PDF route returns
  `content-type: application/pdf` (and a `%PDF` magic body) for a public ruleset; a
  private ruleset's PDF is 404 for a non-owner, 200 for the owner.
