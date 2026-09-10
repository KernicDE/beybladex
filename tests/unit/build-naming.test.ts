// tests/unit/build-naming.test.ts
// Phase 20: the canonical Build naming grammar "<Blade> <Ratchet><Bit-short>" — one space
// between blade and ratchet, the bit's short code appended directly (NO space, NO hyphen).
// Also covers the bit short-code derivation (initials of the bit's name words, matching both
// the seeded single-word Bits and multi-word retail bits like "Gear Flat" → "GF").
import { describe, it, expect } from 'vitest'
import { canonicalBuildName, bitShortCode, deriveBuildName } from '@/lib/buildNaming'

describe('canonicalBuildName — the confirmed grammar', () => {
  it('the plan\'s worked example: "Circle Ghost" + "4-60" + "LR" → "Circle Ghost 4-60LR"', () => {
    expect(canonicalBuildName('Circle Ghost', '4-60', 'LR')).toBe('Circle Ghost 4-60LR')
  })

  it('real retail combos with single-letter bit codes', () => {
    expect(canonicalBuildName('DranSword', '3-60', 'F')).toBe('DranSword 3-60F')
    expect(canonicalBuildName('HellsScythe', '4-60', 'T')).toBe('HellsScythe 4-60T')
    expect(canonicalBuildName('WizardArrow', '4-80', 'B')).toBe('WizardArrow 4-80B')
    expect(canonicalBuildName('KnightShield', '3-80', 'P')).toBe('KnightShield 3-80P')
    expect(canonicalBuildName('SharkEdge', '3-60', 'R')).toBe('SharkEdge 3-60R')
    expect(canonicalBuildName('LeonClaw', '5-60', 'H')).toBe('LeonClaw 5-60H')
    expect(canonicalBuildName('PhoenixWing', '9-60', 'O')).toBe('PhoenixWing 9-60O')
  })

  it('multi-letter bit short codes append with NO hyphen', () => {
    expect(canonicalBuildName('CobaltDragoon', '2-60', 'GF')).toBe('CobaltDragoon 2-60GF')
    expect(canonicalBuildName('ViperTail', '5-80', 'HN')).toBe('ViperTail 5-80HN')
  })

  it('never inserts a separator between ratchet and bit', () => {
    const name = canonicalBuildName('TyrannoBeat', '4-60', 'LF')
    expect(name).toBe('TyrannoBeat 4-60LF')
    expect(name).not.toContain('4-60-LF')
    expect(name).not.toContain('4-60 LF')
  })
})

describe('bitShortCode — initials of the bit name words', () => {
  it('single-word seeded Bits produce exactly the real retail codes', () => {
    expect(bitShortCode('Flat')).toBe('F')
    expect(bitShortCode('Taper')).toBe('T')
    expect(bitShortCode('Ball')).toBe('B')
    expect(bitShortCode('Orb')).toBe('O')
    expect(bitShortCode('Rush')).toBe('R')
    expect(bitShortCode('Hex')).toBe('H')
    expect(bitShortCode('Point')).toBe('P')
  })

  it('multi-word retail Bits take the first letter of each word', () => {
    expect(bitShortCode('Gear Flat')).toBe('GF')
    expect(bitShortCode('Low Rush')).toBe('LR')
    expect(bitShortCode('Low Flat')).toBe('LF')
    expect(bitShortCode('High Needle')).toBe('HN')
    expect(bitShortCode('Metal Rush')).toBe('MR')
  })

  it('normalizes surrounding/extra whitespace and case', () => {
    expect(bitShortCode('  gear   flat ')).toBe('GF')
  })
})

describe('deriveBuildName — full part names in, canonical name out', () => {
  it('derives the bit short code and applies the grammar in one step', () => {
    expect(deriveBuildName('Circle Ghost', '4-60', 'Low Rush')).toBe('Circle Ghost 4-60LR')
    expect(deriveBuildName('DranSword', '3-60', 'Rush')).toBe('DranSword 3-60R')
    expect(deriveBuildName('KnightShield', '3-80', 'Ball')).toBe('KnightShield 3-80B')
  })
})
