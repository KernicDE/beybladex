// lib/seeding.ts (Phase 15)
// Shared seed-ordering + seed-assignment helpers for bracket/Swiss/Round-Robin generation.
// Pure functions (no DB) — unit-testable without infrastructure, same convention as
// lib/bracket.ts / lib/swiss.ts / lib/roundRobin.ts themselves.
//
// ORDERING RULE (replaces the old "no seeding data, sort by userId" documented policy every
// format's own header comment used to carry): sort by TournamentParticipant.seed ASCENDING
// (lower seed number = better bracket position — seed 1 is the top seed), with a participant
// carrying no seed (`null`) sorted AFTER every seeded participant. userId ascending is the
// tie-break for equal or absent seeds — this is the SAME tie-break as before, so the
// zero-seed-set case (every participant's seed is null) produces byte-for-byte the same order
// as pre-Phase-15 (binding acceptance criterion, master plan Phase 15).
// `seed` is optional (not just nullable) so existing call sites/tests that only ever dealt with
// `{ userId }` keep compiling unchanged — an omitted seed is treated identically to an explicit
// null (unseeded).
export type Seedable = { userId: string; seed?: number | null }

export function sortBySeed<T extends Seedable>(participants: T[]): T[] {
  return [...participants].sort((a, b) => {
    const seedA = a.seed ?? null
    const seedB = b.seed ?? null
    if (seedA !== null && seedB !== null) return seedA - seedB
    if (seedA !== null) return -1
    if (seedB !== null) return 1
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0
  })
}

// Assigns seed numbers to every UNSEEDED participant (seed === null), leaving every already
// manually-seeded participant's value untouched — "manual overrides always win" (binding rule).
// New seeds are consecutive integers starting right after the current highest manual seed (or 1
// if nobody has one yet), in the order `rankedOrder` provides — so a manual top-4 seed plus an
// auto-fill of the rest produces seeds 1-4 (manual) then 5..N (auto), matching the real workflow
// the plan describes ("seeds the 4 known top players and lets the rest auto-sort").
export function assignSeedsToUnseeded(
  participants: Seedable[],
  rankedOrderOfUnseededUserIds: string[]
): Map<string, number> {
  const maxManualSeed = participants.reduce((max, p) => (p.seed != null ? Math.max(max, p.seed) : max), 0)
  const result = new Map<string, number>()
  rankedOrderOfUnseededUserIds.forEach((userId, i) => result.set(userId, maxManualSeed + 1 + i))
  return result
}

// Rating-based ordering for the unseeded subset: current-season PlayerRating.elo descending;
// a participant with no rating row this season (never played, or a brand-new account) sorts
// AFTER every rated one, in deterministic userId order among themselves (documented fallback,
// not a silent exclusion — master plan Phase 15 §2).
export function rankUnseededByRating(unseededUserIds: string[], eloByUserId: Map<string, number>): string[] {
  return [...unseededUserIds].sort((a, b) => {
    const eloA = eloByUserId.get(a)
    const eloB = eloByUserId.get(b)
    if (eloA !== undefined && eloB !== undefined) return eloB - eloA
    if (eloA !== undefined) return -1
    if (eloB !== undefined) return 1
    return a < b ? -1 : a > b ? 1 : 0
  })
}

// Fisher-Yates shuffle. Math.random()-based — no fairness/security property needed here, unlike
// auth-adjacent randomness elsewhere in the codebase (master plan Phase 15 §3, explicit).
export function shuffleOrder(userIds: string[]): string[] {
  const arr = [...userIds]
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}
