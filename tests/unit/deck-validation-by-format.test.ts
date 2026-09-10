// tests/unit/deck-validation-by-format.test.ts (Phase 16 item 4)
// validateDeckForFormat: WBO_COUNTERDECK/THREE_ON_THREE keep the pre-Phase-16 3-builds/no-
// duplicate-parts shape unchanged; ONE_ON_ONE accepts exactly one build and rejects two;
// PICK_THREE_CHOOSE_ONE enforces the 3-build count but deliberately SKIPS the duplicate-parts
// check (open question, not yet confirmed with the user — see lib/deckValidation.ts's own
// comment; do not silently invent that rule here either).
import { describe, it, expect } from 'vitest'
import { validateDeckForFormat, requiredBuildCountForFormat } from '@/lib/deckValidation'

const P = { b1: 'blade-1', b2: 'blade-2', b3: 'blade-3', r1: 'ratchet-1', r2: 'ratchet-2', r3: 'ratchet-3', t1: 'bit-1', t2: 'bit-2', t3: 'bit-3' }

function build(id: string, bladeId: string, ratchetId: string, bitId: string) {
  return { id, bladeId, ratchetId, bitId, blade: { name: bladeId }, ratchet: { name: ratchetId }, bit: { name: bitId } }
}

const threeDistinctBuilds = [
  build('build-1', P.b1, P.r1, P.t1),
  build('build-2', P.b2, P.r2, P.t2),
  build('build-3', P.b3, P.r3, P.t3),
]
const threeBuildsSharingABlade = [
  build('build-1', P.b1, P.r1, P.t1),
  build('build-2', P.b1, P.r2, P.t2), // same blade as build-1
  build('build-3', P.b2, P.r3, P.t3),
]

describe('requiredBuildCountForFormat', () => {
  it('is 1 for ONE_ON_ONE and 3 for every other currently-implemented format', () => {
    expect(requiredBuildCountForFormat('ONE_ON_ONE')).toBe(1)
    expect(requiredBuildCountForFormat('WBO_COUNTERDECK')).toBe(3)
    expect(requiredBuildCountForFormat('THREE_ON_THREE')).toBe(3)
    expect(requiredBuildCountForFormat('PICK_THREE_CHOOSE_ONE')).toBe(3)
  })
})

describe('validateDeckForFormat', () => {
  it('WBO_COUNTERDECK: 3 distinct builds pass; a shared part is rejected (unchanged pre-Phase-16 behavior)', () => {
    expect(validateDeckForFormat(threeDistinctBuilds, 'WBO_COUNTERDECK').valid).toBe(true)
    const dup = validateDeckForFormat(threeBuildsSharingABlade, 'WBO_COUNTERDECK')
    expect(dup.valid).toBe(false)
    expect(dup.conflicts.some((c) => c.includes('Blade'))).toBe(true)
  })

  it('THREE_ON_THREE behaves identically to WBO_COUNTERDECK', () => {
    expect(validateDeckForFormat(threeDistinctBuilds, 'THREE_ON_THREE').valid).toBe(true)
    expect(validateDeckForFormat(threeBuildsSharingABlade, 'THREE_ON_THREE').valid).toBe(false)
  })

  it('ONE_ON_ONE accepts exactly one build and rejects two', () => {
    expect(validateDeckForFormat([build('solo', P.b1, P.r1, P.t1)], 'ONE_ON_ONE').valid).toBe(true)
    const rejected = validateDeckForFormat([build('a', P.b1, P.r1, P.t1), build('b', P.b2, P.r2, P.t2)], 'ONE_ON_ONE')
    expect(rejected.valid).toBe(false)
    expect(rejected.conflicts[0]).toContain('genau 1 Build')
  })

  it('a WBO_COUNTERDECK deck with only 2 builds is rejected on count, independent of the duplicate-parts check', () => {
    const result = validateDeckForFormat([build('a', P.b1, P.r1, P.t1), build('b', P.b2, P.r2, P.t2)], 'WBO_COUNTERDECK')
    expect(result.valid).toBe(false)
    expect(result.conflicts[0]).toContain('genau 3 Builds')
  })

  it('PICK_THREE_CHOOSE_ONE enforces the build count but does NOT enforce no-duplicate-parts (open question, deliberately permissive)', () => {
    expect(validateDeckForFormat(threeDistinctBuilds, 'PICK_THREE_CHOOSE_ONE').valid).toBe(true)
    // Same shared-blade deck that WBO_COUNTERDECK rejects — PICK_THREE_CHOOSE_ONE accepts it.
    expect(validateDeckForFormat(threeBuildsSharingABlade, 'PICK_THREE_CHOOSE_ONE').valid).toBe(true)
    // The count rule still applies even though duplicates are permitted.
    expect(validateDeckForFormat([build('a', P.b1, P.r1, P.t1)], 'PICK_THREE_CHOOSE_ONE').valid).toBe(false)
  })
})
