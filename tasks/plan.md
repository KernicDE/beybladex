# Implementation Plan: Issues #197, #198, #199

## Overview
Milestones are no longer used (per user, 2026-09-15). Work is tracked directly
against the three open GitHub issues. Implementation follows the phased
breakdown each issue's own comment thread already proposes. Each phase ships
as its own PR (develop → CI green → merge → manual GoLive per AGENTS.md).

## Decisions
- **#197**: Builds & Sammlung get view-only guest rendering (lock icon removed
  from sidebar for those two); Teams switches from silent `redirect('/login')`
  to `GuestGate`; `/login` gets a "Noch kein Konto? Registrieren" link. Decks
  stays fully gated.
- **#198**: Ship in the order the issue comment proposes — public profile +
  history first (uses existing data), then logo + description + directory,
  then chat, then defer Team-Elo to #199's team-ranking phase (shared work).
- **#199**: Ship Blader/Season extension first (columns, own-rank highlight,
  club filter, pagination) since it reuses existing data. Placement
  (`bestPlacement`/`avgPlacement`) requires a new persisted field written at
  tournament completion — build that as its own slice since both "Bester
  Platz" metrics depend on it for all three groups. Team ranking depends on
  #198's Team-Elo. Club ranking aggregation: no existing product decision
  recorded, so default to **average member Elo, minimum 3 rated members** to
  avoid single-player-inflates-club skew; documented inline.

## Task List
1. #197 — Guest access consistency pass — DONE (PR #200, merged, live)
2. #198a — Team schema (logo, description) + public profile + match history — DONE (PR #201, merged, live)
3. #198b — Team directory (`/teams` public tab, search/filter by club) — DONE (PR #201)
4. #198c — Team chat (reuse ClubMessage pattern) — DONE (PR #201)
5. #199a — Tournament placement persistence (best/avg placement groundwork) — DONE (PR #202 phase 1 merged; placement itself in the follow-up full-scope branch)
6. #199b — Blader ranking: columns, own-rank highlight, club filter, pagination — DONE (PR #202, merged, live)
7. #199c — Team-Elo model + Team ranking tab — DONE (feat/rangliste-full-scope branch)
8. #199d — Club ranking tab (aggregated) — DONE, user decision: show BOTH sum and average Elo (not one or the other)

## #199 full-scope follow-up (branch: feat/rangliste-full-scope)
- `TournamentParticipant.placement` persisted once at tournament completion
  (`lib/tournamentPlacement.ts`), reusing the exact stage-complete ranking
  logic (`lib/bracket.ts`'s `eliminationRanking`, extracted + a real bug
  fixed: the champion match's runner-up was silently dropped from the
  ranking, landing them BELOW every semifinal loser instead of 2nd — this
  bug predates this session and also affected `qualifiedUserIds` advancement
  for a top-2-advance stage).
- `lib/playerStats.ts` — scope-agnostic (Season/Year/All-time) count-based
  stats (matches/wins/losses/rounds/tournaments/best+avg placement). Elo
  itself stays Season-only (PlayerRating/TeamRating) — it's path-dependent,
  can't be retroactively computed for an arbitrary Year/All-time window
  without replaying full match history in order.
- `lib/teamElo.ts` — Team-Elo, wired into `lib/teamStage.ts`'s
  `resolveTeamEncounter` (the encounter, not individual sub-games), gated on
  `Tournament.rankedEligible` + an ACTIVE season, same as the solo path.
- `lib/clubRanking.ts` — sum + average member Elo, gated on 3+ rated members.
- `/rangliste` restructured: 5 destinations (Season/Year/All-time/Teams/Clubs)
  behind a plain Link nav, NOT the shared client `Tabs` component — each tab
  is a different query shape, so client-side switching without a real
  navigation would show the wrong domain's data under the wrong headers.

Checkpoints after each task: `npm run lint`, `npm run typecheck` (or
equivalent), relevant tests, manual verification.
