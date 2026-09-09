// tests/unit/deck-validation.test.ts
// Phase 5 Part A: a deck reusing the same part across two of its builds must fail validation;
// three genuinely distinct builds must pass. Pure unit test — no DB.
import { describe, it, expect } from 'vitest'
import { validateNoDuplicateParts } from '@/lib/deckValidation'

const P = { b1: 'blade-1', b2: 'blade-2', b3: 'blade-3', r1: 'ratchet-1', r2: 'ratchet-2', r3: 'ratchet-3', t1: 'bit-1', t2: 'bit-2', t3: 'bit-3' }

function build(id: string, bladeId: string, ratchetId: string, bitId: string) {
  return { id, bladeId, ratchetId, bitId, blade: { name: bladeId }, ratchet: { name: ratchetId }, bit: { name: bitId } }
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
})
