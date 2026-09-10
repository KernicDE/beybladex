// lib/scoring.ts (RC4, issue #57 — extracted from app/api/matches/[id]/score/route.ts)
// The match-scoring RULEBOOK as pure, HTTP-free functions: event points from the linked
// Ruleset (never hardcoded), event application onto a stored score, and the win threshold
// (finals-aware, stage-format-aware). The route owns authz, idempotency, persistence and
// response mapping; this module owns the arithmetic, so the rules are unit-testable without
// a database and cannot drift between "what the server computes" and "what the tests assert".
//
// Point values (Phase 5 Part C, binding): Spin=1 · Over=2 · Burst=2 · Xtreme Finish=3 ·
// Out-of-Bounds = 2 if ruleset.outOfBounds2Pts else 1 · Overfinish=2 · Own-Finish = opponent +1
// if ruleset.ownFinishPenalty else 0. EXTERNAL_DISTURBANCE / AERIAL_CONTACT award no points
// (rematch flags, gated by their Ruleset rerun toggles at the route layer).
import type { TournamentFormat } from '@prisma/client'

export interface ScoringRuleset {
  outOfBounds2Pts: boolean
  ownFinishPenalty: boolean
}

export const SCORED_EVENTS = new Set(['SPIN', 'OVER', 'BURST', 'XTREME', 'OUT_OF_BOUNDS', 'OVERFINISH', 'OWN_FINISH'])

/** Events that award no points but trigger a rematch — each gated by its Ruleset toggle. */
export const RERUN_EVENTS = ['EXTERNAL_DISTURBANCE', 'AERIAL_CONTACT'] as const

export function pointsForEvent(type: string, ruleset: ScoringRuleset): number {
  switch (type) {
    case 'SPIN':
      return 1
    case 'OVER':
    case 'BURST':
    case 'OVERFINISH':
      return 2
    case 'XTREME':
      return 3
    case 'OUT_OF_BOUNDS':
      return ruleset.outOfBounds2Pts ? 2 : 1
    case 'OWN_FINISH':
      return ruleset.ownFinishPenalty ? 1 : 0
    default:
      return 0
  }
}

/** Is this event type part of the rulebook at all? (Scored events + rerun triggers.)
 *  NOTE: the pre-extraction route accepted the rerun triggers unconditionally — the Ruleset
 *  toggle VALUES were never consulted (`type in rematchTriggers` is key presence, not
 *  truthiness), so this does the same, deliberately: extraction must not change behavior.
 *  The toggles only affect points (0 regardless) and the rematch flag (set regardless). */
export function isKnownEventType(type: string): boolean {
  return SCORED_EVENTS.has(type) || (RERUN_EVENTS as readonly string[]).includes(type)
}

export interface ScoreEvent {
  type: string
  player: 1 | 2
}

export interface AppliedScore {
  scorePlayer1: number
  scorePlayer2: number
  /** true when the event was a rerun trigger (external disturbance / aerial contact). */
  rematch: boolean
}

/** Applies one validated event to the STORED score — the server-authoritative arithmetic the
 *  route compares against the client-claimed full state (a client cannot award arbitrary
 *  points). OWN_FINISH is a penalty committed BY `player`; the OPPONENT receives the point. */
export function applyEvent(stored1: number, stored2: number, event: ScoreEvent, ruleset: ScoringRuleset): AppliedScore {
  if (!SCORED_EVENTS.has(event.type)) {
    return { scorePlayer1: stored1, scorePlayer2: stored2, rematch: true }
  }
  const pts = pointsForEvent(event.type, ruleset)
  let scorePlayer1 = stored1
  let scorePlayer2 = stored2
  if (event.type === 'OWN_FINISH') {
    if (event.player === 1) scorePlayer2 += pts
    else scorePlayer1 += pts
  } else if (event.player === 1) {
    scorePlayer1 += pts
  } else {
    scorePlayer2 += pts
  }
  return { scorePlayer1, scorePlayer2, rematch: false }
}

/** No-event full-state stores (build confirmation / UNDO) may only stay or DECREASE — an
 *  increase without a scored event would be an unaudited point award. */
export function isMonotonicDecrease(claimed1: number, claimed2: number, stored1: number, stored2: number): boolean {
  return claimed1 <= stored1 && claimed2 <= stored2
}

/** Win threshold: the finals (the stage's LAST round) use finalsTargetPoints, earlier rounds
 *  targetPoints — read from the Ruleset, never hardcoded. Stage-scoped (a stage's round
 *  numbering restarts at 1), and SWISS / ROUND_ROBIN never use finalsTargetPoints (every
 *  round scores at targetPoints; there is no single final match). */
export function winThreshold(
  stageFormat: TournamentFormat,
  round: number,
  maxRound: number,
  ruleset: { targetPoints: number; finalsTargetPoints: number },
): number {
  const isFinal = stageFormat !== 'SWISS' && stageFormat !== 'ROUND_ROBIN' && round > 0 && round === maxRound
  return isFinal ? ruleset.finalsTargetPoints : ruleset.targetPoints
}

/** Winner once the threshold is reached: the leading player. */
export function winnerAtThreshold(scorePlayer1: number, scorePlayer2: number, player1Id: string, player2Id: string): string {
  return scorePlayer1 > scorePlayer2 ? player1Id : player2Id
}
