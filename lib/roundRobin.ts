// lib/roundRobin.ts
// Phase 5 Part C3 — Round-Robin fixture generation via the standard CIRCLE METHOD (fix one
// participant, rotate the rest). For n participants this yields n−1 rounds (even n) or n rounds
// with one bye per round (odd n — the bye is a scheduling artifact: no match is produced for the
// byed player that round, NOT a ranking event, so unlike Swiss there is no bye-counting here) of
// floor(n/2) non-overlapping pairs each, and every unordered pair meets exactly once per pass.
//
// Determinism: participants are sorted by lib/seeding.ts's sortBySeed first (Phase 15:
// TournamentParticipant.seed ascending, unseeded last, userId tie-break — the same convention
// lib/bracket.ts uses), and the top seed (or lowest userId, unseeded) is the fixed circle pivot.
//
// Repeats: for repeats > 1 the full pass is appended again, with player1Id/player2Id SWAPPED on
// even-numbered passes (home/away alternation) — which nominal "player1" a match assigns has no
// gameplay meaning (scoring is symmetric), but alternating avoids one player mechanically always
// occupying the player1 slot across every meeting.
//
// Pure function (no DB) so the whole fixture list is unit-testable without infrastructure.
import type { TournamentParticipant } from '@prisma/client'
import { sortBySeed } from '@/lib/seeding'

export type RoundRobinPairing = { round: number; player1Id: string; player2Id: string }

export function generateRoundRobinPairings(
  participants: (Pick<TournamentParticipant, 'userId'> & { seed?: number | null })[],
  repeats: number
): RoundRobinPairing[] {
  const sorted = sortBySeed(participants).map((p) => p.userId)
  if (sorted.length < 2) return []

  // Odd field: a phantom null slot completes the circle; the participant mirrored against it
  // sits out that round (the bye). Rounds = n (odd) or n−1 (even).
  const odd = sorted.length % 2 === 1
  const circle: (string | null)[] = odd ? [...sorted, null] : [...sorted]
  const rounds = circle.length - 1
  const matchesPerRound = circle.length / 2

  // One full pass: the pivot (index 0) is fixed; all other slots rotate one step each round.
  const pass: { round: number; a: string; b: string }[] = []
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < matchesPerRound; i++) {
      const left = circle[i]
      const right = circle[circle.length - 1 - i]
      if (left !== null && right !== null) pass.push({ round: r + 1, a: left, b: right })
    }
    // Rotate positions 1..end one step left (position 0, the pivot, stays put).
    circle.splice(1, 0, circle.pop()!)
  }

  // Assemble passes; even-numbered passes (2nd, 4th, …) swap the player slots (home/away).
  const pairings: RoundRobinPairing[] = []
  const totalPasses = Math.max(1, Math.floor(repeats))
  for (let p = 1; p <= totalPasses; p++) {
    const swap = p % 2 === 0
    for (const m of pass) {
      pairings.push({
        round: (p - 1) * rounds + m.round,
        player1Id: swap ? m.b : m.a,
        player2Id: swap ? m.a : m.b,
      })
    }
  }
  return pairings
}
