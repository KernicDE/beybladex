// tests/unit/deck-validation.test.ts
// Phase 5 Part A: a deck reusing the same part across two of its builds must fail validation;
// three genuinely distinct builds must pass. Pure unit test — no DB.
import { describe, it, expect } from 'vitest'
import { validateNoDuplicateParts } from '@/lib/deckValidation'

const P = { b1: 'blade-1', b2: 'blade-2', b3: 'blade-3', r1: 'ratchet-1', r2: 'ratchet-2', r3: 'ratchet-3', t1: 'bit-1', t2: 'bit-2', t3: 'bit-3' }

function build(id: string, bladeId: string | null, ratchetId: string | null, bitId: string) {
  return {
    id,
    bladeId,
    lockChipId: null,
    overBladeId: null,
    metalBladeId: null,
    assistBladeId: null,
    ratchetId,
    bitId,
    blade: bladeId !== null ? { name: bladeId } : null,
    ratchet: ratchetId !== null ? { name: ratchetId } : null,
    bit: { name: bitId },
  }
}

describe('validateNoDuplicateParts', () => {
  it('rejects a deck where two of three builds share the same blade', () => {
    const { valid, conflicts } = validateNoDuplicateParts([
      build('build-1', P.b1, P.r1, P.t1),
      build('build-2', P.b1, P.r2, P.t2), // same blade as build-1
      build('build-3', P.b2, P.r3, P.t3),
    ])
    expect(valid).toBe(false)
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toContain('Blade')
    expect(conflicts[0]).toContain(P.b1)
    expect(conflicts[0]).toContain('2×')
  })

  it('flags a duplicate ratchet and a duplicate bit independently', () => {
    const { valid, conflicts } = validateNoDuplicateParts([
      build('build-1', P.b1, P.r1, P.t1),
      build('build-2', P.b2, P.r1, P.t2), // duplicate ratchet
      build('build-3', P.b3, P.r3, P.t1), // duplicate bit
    ])
    expect(valid).toBe(false)
    expect(conflicts).toHaveLength(2)
    expect(conflicts.some((c) => c.startsWith('Ratchet'))).toBe(true)
    expect(conflicts.some((c) => c.startsWith('Bit'))).toBe(true)
  })

  it('accepts three genuinely distinct builds', () => {
    const { valid, conflicts } = validateNoDuplicateParts([
      build('build-1', P.b1, P.r1, P.t1),
      build('build-2', P.b2, P.r2, P.t2),
      build('build-3', P.b3, P.r3, P.t3),
    ])
    expect(valid).toBe(true)
    expect(conflicts).toEqual([])
  })

  it('RC16 (#122): leere Slots (Ratchet-Integrated ratchetId null) sind KEIN Konflikt', () => {
    const { valid, conflicts } = validateNoDuplicateParts([
      build('integrated-1', 'valor-bison-fb', null, P.t1),
      build('integrated-2', 'rocket-griffon-h', null, P.t2),
    ])
    expect(valid).toBe(true)
    expect(conflicts).toEqual([])
  })

  it('RC16 (#122): geteilte Custom-Line-Teile werden wie Standard-Teile als Konflikt geflaggt', () => {
    const cx = (id: string, bitId: string) => ({
      id,
      bladeId: null,
      lockChipId: 'lock-chip-1',
      overBladeId: 'over-blade-1',
      metalBladeId: 'metal-blade-1',
      assistBladeId: 'assist-blade-1',
      ratchetId: P.r1,
      bitId,
      lockChip: { name: 'Lock Chip 1' },
      overBlade: { name: 'Over Blade 1' },
      metalBlade: { name: 'Metal Blade 1' },
      assistBlade: { name: 'Assist Blade 1' },
      ratchet: { name: P.r1 },
      bit: { name: bitId },
    })
    const { valid, conflicts } = validateNoDuplicateParts([cx('cx-1', P.t1), cx('cx-2', P.t2)])
    expect(valid).toBe(false)
    expect(conflicts.some((c) => c.startsWith('Lock Chip'))).toBe(true)
    expect(conflicts.some((c) => c.startsWith('Ratchet'))).toBe(true)
  })
})
