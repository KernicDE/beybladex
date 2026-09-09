// tests/unit/swiss.test.ts
// Phase 5 Part C2 — Swiss pairing: determinism, rematch avoidance (incl. the lookahead-swap case
// and the no-alternative fallback), bye rotation on odd fields, and a full 3-round simulation
// asserting no pairing is ever repeated and the final order matches recorded wins.
import { describe, it, expect } from 'vitest'
import { pairSwissRound, computeBuchholz, type SwissPlayer } from '@/lib/swiss'

function player(userId: string, over: Partial<Omit<SwissPlayer, 'userId'>> = {}): SwissPlayer {
  return { userId, wins: 0, buchholz: 0, opponentIds: [], byes: 0, ...over }
}

describe('pairSwissRound', () => {
  it('pairs adjacent players in (wins, buchholz, userId) order deterministically', () => {
    const { pairings } = pairSwissRound([
      player('s3', { wins: 1 }),
      player('s1'),
      player('s4', { wins: 1 }),
      player('s2'),
    ])
    // s3/s4 (1 win, bh 0) first — s3 before s4 by userId; then s1/s2.
    expect(pairings).toEqual([
      { player1Id: 's3', player2Id: 's4' },
      { player1Id: 's1', player2Id: 's2' },
    ])
  })

  it('uses buchholz before userId at equal wins', () => {
    const { pairings } = pairSwissRound([
      player('a', { wins: 1, buchholz: 0 }),
      player('b', { wins: 1, buchholz: 3 }),
      player('c', { wins: 1, buchholz: 1 }),
      player('d', { wins: 1, buchholz: 2 }),
    ])
    expect(pairings).toEqual([
      { player1Id: 'b', player2Id: 'd' },
      { player1Id: 'c', player2Id: 'a' },
    ])
  })

  it('lookahead-swap avoids a rematch when a rematch-free pairing exists', () => {
    // Classic trap: greedy adjacent pairing would pair a–b (a repeat); the lookahead must swap.
    const { pairings } = pairSwissRound([
      player('a', { opponentIds: ['b'] }),
      player('b', { opponentIds: ['a'] }),
      player('c', { opponentIds: ['d'] }),
      player('d', { opponentIds: ['c'] }),
    ])
    const keys = pairings.map((p) => [p.player1Id, p.player2Id].sort().join('-'))
    expect(keys).toEqual(expect.arrayContaining(['a-c', 'b-d']))
    expect(keys).not.toContain('a-b')
    expect(keys).not.toContain('c-d')
  })

  it('documented fallback: allows a repeat pairing when NO rematch-free alternative exists', () => {
    // 3 players, only two have played each other, but the odd-count bye removes the escape:
    // s1–s2 is a forced rematch (s3 takes the bye, leaving only s1 and s2 in the pool).
    const { pairings } = pairSwissRound([
      player('s1', { wins: 1, opponentIds: ['s2'] }),
      player('s2', { opponentIds: ['s1'] }),
      player('s3'),
    ])
    expect(pairings).toEqual([
      { player1Id: 's3', player2Id: null }, // bye: lowest-ranked not-yet-byed
      { player1Id: 's1', player2Id: 's2' }, // forced rematch — documented fallback
    ])
  })

  it('odd field: bye goes to the lowest-ranked not-yet-byed player; never the same player twice', () => {
    const round1 = pairSwissRound([player('s1'), player('s2'), player('s3'), player('s4'), player('s5')])
    // Bye is listed first (implementation convention); the four pairings follow in seed order.
    expect(round1.pairings).toEqual([
      { player1Id: 's5', player2Id: null }, // bye
      { player1Id: 's1', player2Id: 's2' },
      { player1Id: 's3', player2Id: 's4' },
    ])
    // Round 2: s2 and s4 win, s5 got the bye-win; all three are 1-0. s3 (0-1, byes 0) is the
    // lowest-ranked not-yet-byed player → s3 gets the bye, NOT s5 again.
    const round2 = pairSwissRound([
      player('s1', { opponentIds: ['s2'] }),
      player('s2', { wins: 1, opponentIds: ['s1'] }),
      player('s3', { opponentIds: ['s4'] }),
      player('s4', { wins: 1, opponentIds: ['s3'] }),
      player('s5', { wins: 1, byes: 1 }),
    ])
    const bye = round2.pairings.find((p) => p.player2Id === null)
    expect(bye).toEqual({ player1Id: 's3', player2Id: null })
  })

  it('empty field pairs nothing', () => {
    expect(pairSwissRound([])).toEqual({ pairings: [] })
  })
})

describe('3-round Swiss simulation over 8 players — scripted deterministic results', () => {
  it('never repeats a pairing across 3 rounds and the final order matches recorded wins', () => {
    const ids = Array.from({ length: 8 }, (_, i) => `s${i + 1}`)
    let standings: SwissPlayer[] = ids.map((id) => player(id))
    const played = new Set<string>()
    // Higher-ranked player always wins (player1 slot) — deterministic scripted results.
    const key = (a: string, b: string) => [a, b].sort().join('-')

    const roundPairings: string[][] = []
    for (let round = 1; round <= 3; round++) {
      const buchholz = computeBuchholz(standings)
      standings = standings.map((s) => ({ ...s, buchholz: buchholz.get(s.userId) ?? 0 }))
      const { pairings } = pairSwissRound(standings)
      roundPairings.push(pairings.map((p) => `${p.player1Id}-${p.player2Id ?? 'BYE'}`))

      for (const p of pairings) {
        if (p.player2Id === null) {
          // Bye: automatic win, no opponent recorded.
          standings = standings.map((s) => (s.userId === p.player1Id ? { ...s, wins: s.wins + 1, byes: s.byes + 1 } : s))
          continue
        }
        expect(played.has(key(p.player1Id, p.player2Id)), `repeat pairing ${p.player1Id} vs ${p.player2Id} in round ${round}`).toBe(false)
        played.add(key(p.player1Id, p.player2Id))
        // player1 (higher-ranked) wins; both record the opponent.
        standings = standings.map((s) =>
          s.userId === p.player1Id
            ? { ...s, wins: s.wins + 1, opponentIds: [...s.opponentIds, p.player2Id!] }
            : s.userId === p.player2Id
              ? { ...s, opponentIds: [...s.opponentIds, p.player1Id] }
              : s
        )
      }
    }

    // Round 1 must be pure adjacent seeding; later rounds are rematch-avoided (proven above by
    // the no-repeat assertion across all 3 rounds × 4 pairings = 12 distinct pairings).
    expect(roundPairings[0]).toEqual(['s1-s2', 's3-s4', 's5-s6', 's7-s8'])
    expect(played.size).toBe(12)

    // Final standings order is consistent with recorded wins. Hand-traced for the scripted
    // results (player1 always wins): s1 3-0; the 2-1 group ordered by final buchholz
    // (s2: 4 > s5: 3 > s6: 2); the 1-2 group (s3: 4 > s4: 3 > s7: 2); s8 0-3.
    const final = [...standings].sort((a, b) => b.wins - a.wins || b.buchholz - a.buchholz || (a.userId < b.userId ? -1 : 1))
    expect(final.map((s) => s.userId)).toEqual(['s1', 's2', 's5', 's6', 's3', 's4', 's7', 's8'])
    expect(final.map((s) => s.wins)).toEqual([3, 2, 2, 2, 1, 1, 1, 0])
    // …and every standing's opponent history matches what was actually played.
    for (const s of standings) {
      expect(s.opponentIds).toHaveLength(3)
      for (const opp of s.opponentIds) {
        expect(played.has(key(s.userId, opp))).toBe(true)
      }
    }
  })
})

describe('computeBuchholz', () => {
  it('sums current opponent win counts', () => {
    const map = computeBuchholz([
      player('a', { wins: 2, opponentIds: ['b', 'c'] }),
      player('b', { wins: 1 }),
      player('c', { wins: 0 }),
    ])
    expect(map.get('a')).toBe(1)
    expect(map.get('b')).toBe(0)
    expect(map.get('c')).toBe(0)
  })
})
