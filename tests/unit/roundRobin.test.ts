// tests/unit/roundRobin.test.ts
// Phase 5 Part C3 — circle-method Round-Robin scheduling. The properties that matter are verified
// PROGRAMMATICALLY over ALL pairs (loop, not hand-picked cases): every unordered pair meets
// exactly `repeats` times, no round contains a participant twice, and the odd-count case rotates
// byes so every participant is byed exactly once before anyone is byed twice.
import { describe, it, expect } from 'vitest'
import { generateRoundRobinPairings } from '@/lib/roundRobin'

const participants = (n: number) => Array.from({ length: n }, (_, i) => ({ userId: `p${i + 1}` }))
const pairKey = (a: string, b: string) => [a, b].sort().join('-')

function verifyFullRoundRobin(n: number, repeats = 1) {
  const ids = participants(n).map((p) => p.userId)
  const matches = generateRoundRobinPairings(participants(n), repeats)

  // Round structure: n rounds (odd n, one bye per round) or n−1 rounds (even n, no byes) PER
  // PASS — repeats passes append repeats × that many distinct round numbers — each with
  // floor(n/2) matches per round.
  const expectedRounds = (n % 2 === 1 ? n : n - 1) * repeats
  const perRound = new Map<number, typeof matches>()
  for (const m of matches) {
    if (!perRound.has(m.round)) perRound.set(m.round, [])
    perRound.get(m.round)!.push(m)
  }
  expect(perRound.size).toBe(expectedRounds)
  for (const [round, roundMatches] of perRound) {
    expect(roundMatches.length, `round ${round} match count`).toBe(Math.floor(n / 2))

    // No participant appears twice within a round; the rest of the field is byed exactly
    // (n − 2·floor(n/2)) times (1 for odd n, 0 for even n).
    const inRound = roundMatches.flatMap((m) => [m.player1Id, m.player2Id])
    expect(new Set(inRound).size, `round ${round} has a participant twice`).toBe(inRound.length)
    const byed = ids.filter((id) => !inRound.includes(id))
    expect(byed.length).toBe(n % 2 === 1 ? 1 : 0)
  }

  // Pair completeness across the whole fixture list: every unordered pair meets exactly
  // `repeats` times — none missing, none duplicated.
  const counts = new Map<string, number>()
  for (const m of matches) {
    const key = pairKey(m.player1Id, m.player2Id)
    counts.set(key, (counts.get(key) ?? 0) + 1)
    expect(m.player1Id).not.toBe(m.player2Id)
  }
  expect(counts.size).toBe((n * (n - 1)) / 2)
  for (const a of ids) {
    for (const b of ids) {
      if (a >= b) continue
      expect(counts.get(pairKey(a, b)), `pair ${a}-${b}`).toBe(repeats)
    }
  }

  // Odd-count bye rotation: within EACH PASS every participant is byed exactly once (so
  // `repeats` byes total across the fixture list — one per pass, never twice before everyone
  // else had one).
  if (n % 2 === 1) {
    const byeCounts = new Map<string, number>()
    const roundsPerPass = n
    for (const [round, roundMatches] of perRound) {
      const inRound = new Set(roundMatches.flatMap((m) => [m.player1Id, m.player2Id]))
      const byed = ids.filter((id) => !inRound.has(id))
      expect(byed.length, `round ${round} bye count`).toBe(1)
      byeCounts.set(byed[0], (byeCounts.get(byed[0]) ?? 0) + 1)
      // Within the pass containing this round the bye must be unique per participant.
      const roundInPass = ((round - 1) % roundsPerPass) + 1
      for (const [, earlier] of [...perRound.entries()].filter(([r]) => r < round && ((r - 1) % roundsPerPass) + 1 === roundInPass && Math.ceil(r / roundsPerPass) === Math.ceil(round / roundsPerPass))) {
        const earlierByed = ids.filter((id) => !new Set(earlier.flatMap((m) => [m.player1Id, m.player2Id])).has(id))
        expect(earlierByed[0]).not.toBe(byed[0])
      }
    }
    for (const id of ids) expect(byeCounts.get(id), `byes for ${id}`).toBe(repeats)
  }

  return { matches, perRound }
}

describe('generateRoundRobinPairings', () => {
  it('5 participants (odd): every pair meets once, one bye per round, each byed exactly once', () => {
    verifyFullRoundRobin(5)
  })

  it('6 participants (even): every pair meets once, no byes, n−1 rounds', () => {
    verifyFullRoundRobin(6)
  })

  it('rounds are 1-based and dense (no gaps)', () => {
    const { matches } = verifyFullRoundRobin(5)
    const rounds = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b)
    expect(rounds).toEqual([1, 2, 3, 4, 5])
  })

  it('is deterministic for a shuffled input (participants sorted by userId first)', () => {
    const shuffled = [{ userId: 'p4' }, { userId: 'p1' }, { userId: 'p5' }, { userId: 'p2' }, { userId: 'p3' }]
    const a = generateRoundRobinPairings(shuffled, 1)
    const b = generateRoundRobinPairings(participants(5), 1)
    expect(a).toEqual(b)
  })

  it('repeats: 2 — every pair meets twice with player1Id/player2Id swapped on the second pass', () => {
    const { matches } = verifyFullRoundRobin(4, 2)
    expect(matches.length).toBe(2 * ((4 * 3) / 2)) // 12
    const meetings = new Map<string, { p1: string; p2: string; rounds: number[] }[]>()
    for (const m of matches) {
      const key = pairKey(m.player1Id, m.player2Id)
      if (!meetings.has(key)) meetings.set(key, [])
      meetings.get(key)!.push({ p1: m.player1Id, p2: m.player2Id, rounds: [m.round] })
    }
    for (const list of meetings.values()) {
      expect(list.length).toBe(2)
      const [first, second] = list
      expect(second.p1).toBe(first.p2)
      expect(second.p2).toBe(first.p1)
      expect(second.rounds[0]).toBeGreaterThan(first.rounds[0]) // pass 2 strictly after pass 1
    }
  })

  it('repeats: 3 — every pair meets exactly three times', () => {
    verifyFullRoundRobin(5, 3)
  })

  it('fewer than 2 participants yields no matches', () => {
    expect(generateRoundRobinPairings([], 1)).toEqual([])
    expect(generateRoundRobinPairings(participants(1), 1)).toEqual([])
  })
})
