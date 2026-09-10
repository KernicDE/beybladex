// lib/elo.ts (Phase 14)
// Pure Elo-rating math — no Prisma import, unit-testable in isolation (per the plan's own
// acceptance criteria: exact before/after values at both K-factor tiers, not a tolerance band).
//
// K-FACTOR, binding decision (see master plan Phase 14 §2): K = 40 for a player's first 30
// rated games in a season ("provisional" period — fast placement, matching common chess-
// federation practice), K = 20 afterward. `gamesPlayed` passed in here is the count BEFORE
// this match (i.e. "how many rated games did this player have coming into this match") — the
// caller increments it separately after applying the result.
export function kFactor(gamesPlayedBeforeThisMatch: number): number {
  return gamesPlayedBeforeThisMatch < 30 ? 40 : 20
}

// Standard logistic expected-score formula.
export function expectedScore(eloSelf: number, eloOpponent: number): number {
  return 1 / (1 + 10 ** ((eloOpponent - eloSelf) / 400))
}

export type EloResult = { newElo: number; delta: number }

// score: 1 for a win, 0 for a loss (no draws in Beyblade X match play — every completed Match
// has exactly one winnerId). Result is rounded to the nearest integer (Elo is conventionally an
// integer rating); rounding happens once, here, so callers never round differently.
export function applyEloResult(eloSelf: number, eloOpponent: number, score: 0 | 1, gamesPlayedBeforeThisMatch: number): EloResult {
  const k = kFactor(gamesPlayedBeforeThisMatch)
  const expected = expectedScore(eloSelf, eloOpponent)
  const newElo = Math.round(eloSelf + k * (score - expected))
  return { newElo, delta: newElo - eloSelf }
}

// Season-rollover regression-to-mean (master plan Phase 14 §3, binding decision): a returning
// player's new-season starting rating pulls 25% of the way back toward the 1000 baseline,
// rather than a hard reset or a full carry-over. A brand-new player (no prior rating) simply
// starts at 1000 via the model default — this function is only ever called with a real prior elo.
export function regressToMean(oldElo: number): number {
  return Math.round(oldElo * 0.75 + 1000 * 0.25)
}

// Public-leaderboard minimum-games gate (master plan Phase 14 §4): a rating exists and updates
// internally from game 1, but only appears on the public ladder once the player has 5+ rated
// games this season — avoids a 1-0 record showing as a false "#1".
export const MIN_RATED_GAMES_FOR_LADDER = 5
