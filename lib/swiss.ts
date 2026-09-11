// lib/swiss.ts
// Phase 5 Part C2 — Swiss-system pairing ("Swiss-lite", NOT a full Dutch/accelerated system —
// acceptable per the plan given this platform's realistic tournament sizes).
//
// Algorithm:
//   1. Sort by (wins desc, buchholz desc, seed asc [Phase 15], userId asc) — buchholz is the
//      sum of opponents' win counts at pairing time; seed only ever matters for ROUND 1 (every
//      standing starts at wins=0/buchholz=0, so seed IS the round-1 tiebreak — from round 2 on,
//      real results dominate and seed stops mattering, which is the correct behavior: seeding
//      places players into the initial field, it doesn't keep re-influencing pairing once
//      they've actually played). userId remains the final, fully-deterministic tiebreak.
//   2. Odd field: the LOWEST-RANKED player who has not yet received a bye (StageStanding.byes)
//      leaves the pool and gets a bye (player2Id: null — an automatic win). Fallback documented:
//      if every player has already had a bye (mathematically possible only in tiny fields), the
//      lowest-ranked player overall gets the repeat bye rather than failing the pairing.
//   3. Greedy adjacent pairing on the sorted pool with swap-based rematch avoidance: for the
//      highest-ranked unpaired player a, scan DOWN the order for the first player not present in
//      a.opponentIds and pair them. Fallback documented: if NO rematch-free partner exists at all
//      (possible only in small/late-round fields), pair with the next player in order — a repeat
//      pairing rather than a failure.
//
// Pure function (no DB) so the whole Swiss lifecycle is unit-testable without infrastructure.
import type { StageStanding } from '@prisma/client'

// Phase 15: `seed` is NOT a StageStanding column — it's supplied by the caller (the generate
// route) only when pairing ROUND 1, read from TournamentParticipant.seed at that moment. Every
// later round omits it (undefined), which the tiebreak below treats identically to null.
export type SwissPlayer = Pick<StageStanding, 'userId' | 'wins' | 'buchholz' | 'opponentIds' | 'byes'> & {
  seed?: number | null
}

export type SwissPairing = { player1Id: string; player2Id: string | null }

export function sortSwiss(standings: SwissPlayer[]): SwissPlayer[] {
  return [...standings].sort((a, b) => {
    if (a.wins !== b.wins) return b.wins - a.wins
    if (a.buchholz !== b.buchholz) return b.buchholz - a.buchholz
    const seedA = a.seed ?? null
    const seedB = b.seed ?? null
    if (seedA !== null && seedB !== null && seedA !== seedB) return seedA - seedB
    if (seedA !== null && seedB === null) return -1
    if (seedA === null && seedB !== null) return 1
    return a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0
  })
}

export function pairSwissRound(standings: SwissPlayer[]): { pairings: SwissPairing[] } {
  const sorted = sortSwiss(standings)
  const pairings: SwissPairing[] = []
  if (sorted.length === 0) return { pairings }

  // Bye for an odd field: lowest-ranked not-yet-byed player (fallback: lowest-ranked overall).
  let pool = sorted
  if (sorted.length % 2 === 1) {
    let byeIndex = -1
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].byes === 0) {
        byeIndex = i
        break
      }
    }
    if (byeIndex === -1) byeIndex = sorted.length - 1
    pairings.push({ player1Id: sorted[byeIndex].userId, player2Id: null })
    pool = sorted.filter((_, i) => i !== byeIndex)
  }

  const paired = new Set<number>()
  for (let i = 0; i < pool.length; i++) {
    if (paired.has(i)) continue
    const a = pool[i]
    // Look ahead for the first rematch-free partner; fall back to the adjacent player.
    let partner = -1
    for (let j = i + 1; j < pool.length; j++) {
      if (paired.has(j)) continue
      if (!a.opponentIds.includes(pool[j].userId)) {
        partner = j
        break
      }
    }
    if (partner === -1) {
      for (let j = i + 1; j < pool.length; j++) {
        if (!paired.has(j)) {
          partner = j
          break
        }
      }
    }
    if (partner === -1) continue
    paired.add(i)
    paired.add(partner)
    pairings.push({ player1Id: a.userId, player2Id: pool[partner].userId })
  }
  return { pairings }
}

/**
 * Buchholz recompute: sum of CURRENT win counts over everyone in opponentIds. A withdrawn
 * opponent contributes their wins up to withdrawal (their remaining matches never happened).
 * Parametertyp bewusst minimal (RC7 #66): Aufrufstellen liefern ganze StageStanding-Zeilen, die
 * ohne Cast hier hineinpassen.
 */
export function computeBuchholz(
  standings: Pick<StageStanding, 'userId' | 'wins' | 'opponentIds'>[],
): Map<string, number> {
  const winsByUser = new Map(standings.map((s) => [s.userId, s.wins]))
  return new Map(standings.map((s) => [s.userId, s.opponentIds.reduce((sum, id) => sum + (winsByUser.get(id) ?? 0), 0)]))
}
