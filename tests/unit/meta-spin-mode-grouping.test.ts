// tests/unit/meta-spin-mode-grouping.test.ts (Phase 16 item 3)
// A dual-spin part's win rate is computed SEPARATELY per mode (composite `${partId}:${mode}`
// keys), never conflating a RIGHT-mode and LEFT-mode use into one misleading number; a
// fixed-spin part's aggregation is completely unaffected by this change (the bare-key entry
// behaves identically with or without a dualSpinPartIds set).
import { describe, it, expect } from 'vitest'
import { aggregateWinRates } from '@/lib/meta'
import type { CompletedMatchRow, BuildPartsRow } from '@/lib/meta'

function bp(id: string, bladeId: string, ratchetId: string, bitId: string): BuildPartsRow {
  return { id, bladeId, ratchetId, bitId }
}

function match(
  p1: string,
  b1: string,
  p2: string,
  b2: string,
  winner: string,
  spin1: 'RIGHT' | 'LEFT' | null = null,
  spin2: 'RIGHT' | 'LEFT' | null = null
): CompletedMatchRow {
  return { player1Id: p1, player2Id: p2, player1BuildId: b1, player2BuildId: b2, winnerId: winner, player1SpinMode: spin1, player2SpinMode: spin2 }
}

describe('dual-spin part grouping', () => {
  it('RIGHT-mode and LEFT-mode appearances of the same dual-spin part land in separate composite entries', () => {
    const buildParts = new Map<string, BuildPartsRow>()
    buildParts.set('build-right-user', bp('build-right-user', 'blade1', 'ratchet1', 'DUAL_BIT'))
    buildParts.set('build-left-user', bp('build-left-user', 'blade1', 'ratchet1', 'DUAL_BIT'))
    buildParts.set('opp-build', bp('opp-build', 'blade2', 'ratchet2', 'bit2'))

    const matches: CompletedMatchRow[] = [
      // Three RIGHT-mode wins.
      match('p1', 'build-right-user', 'o1', 'opp-build', 'p1', 'RIGHT'),
      match('p1', 'build-right-user', 'o2', 'opp-build', 'p1', 'RIGHT'),
      match('p1', 'build-right-user', 'o3', 'opp-build', 'o3', 'RIGHT'), // one loss in RIGHT mode
      // Two LEFT-mode wins.
      match('p2', 'build-left-user', 'o4', 'opp-build', 'p2', 'LEFT'),
      match('p2', 'build-left-user', 'o5', 'opp-build', 'o5', 'LEFT'), // one loss in LEFT mode
    ]

    const { parts } = aggregateWinRates(matches, buildParts, ['DUAL_BIT'], new Set(['DUAL_BIT']))

    const rightStats = parts.get('DUAL_BIT:RIGHT')!
    const leftStats = parts.get('DUAL_BIT:LEFT')!
    const bareStats = parts.get('DUAL_BIT')!

    expect(rightStats.wins).toBe(2)
    expect(rightStats.losses).toBe(1)
    expect(leftStats.wins).toBe(1)
    expect(leftStats.losses).toBe(1)
    // The bare key still aggregates across BOTH modes (mode-agnostic convenience figure for
    // non-/meta consumers) — never removed, just supplemented by the composite entries.
    expect(bareStats.wins).toBe(3)
    expect(bareStats.losses).toBe(2)
  })

  it('a fixed-spin (non-dual-spin) part is completely unaffected: only the bare key exists, spin mode is ignored', () => {
    const buildParts = new Map<string, BuildPartsRow>()
    buildParts.set('bx', bp('bx', 'FIXED_BLADE', 'r1', 'b1'))
    buildParts.set('by', bp('by', 'blade2', 'r2', 'b2'))

    const matches: CompletedMatchRow[] = [
      match('p1', 'bx', 'o1', 'by', 'p1', 'RIGHT'), // a spin mode present but the part isn't dual-spin
      match('p1', 'bx', 'o2', 'by', 'o2'),
    ]

    // dualSpinPartIds omitted entirely — FIXED_BLADE is never treated as dual-spin.
    const { parts } = aggregateWinRates(matches, buildParts, ['FIXED_BLADE'])

    expect(parts.has('FIXED_BLADE:RIGHT')).toBe(false)
    expect(parts.has('FIXED_BLADE:LEFT')).toBe(false)
    const stats = parts.get('FIXED_BLADE')!
    expect(stats.wins).toBe(1)
    expect(stats.losses).toBe(1)
  })

  it('a dual-spin part appearance with no recorded spin mode (legacy data) contributes to the bare key only', () => {
    const buildParts = new Map<string, BuildPartsRow>()
    buildParts.set('bx', bp('bx', 'blade1', 'ratchet1', 'DUAL_BIT'))
    buildParts.set('by', bp('by', 'blade2', 'ratchet2', 'bit2'))

    const matches: CompletedMatchRow[] = [match('p1', 'bx', 'o1', 'by', 'p1')] // no spin mode recorded

    const { parts } = aggregateWinRates(matches, buildParts, ['DUAL_BIT'], new Set(['DUAL_BIT']))

    expect(parts.get('DUAL_BIT')!.wins).toBe(1)
    expect(parts.get('DUAL_BIT:RIGHT')!.wins).toBe(0)
    expect(parts.get('DUAL_BIT:LEFT')!.wins).toBe(0)
  })
})
