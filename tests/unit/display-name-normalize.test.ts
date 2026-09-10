// tests/unit/display-name-normalize.test.ts
// Phase 19 — lib/displayName.ts's normalizeDisplayName (the pure function behind
// User.displayNameNormalized). Covers: case-folding, trimming, NFKC folding of real
// look-alike/compatibility forms, and null handling.
import { describe, it, expect } from 'vitest'
import { normalizeDisplayName } from '@/lib/displayName'

describe('normalizeDisplayName', () => {
  it('returns null for a null display name (users without one never collide)', () => {
    expect(normalizeDisplayName(null)).toBeNull()
  })

  it('case-folds and trims so differently-cased/spaced names collide', () => {
    expect(normalizeDisplayName('MaxMustermann')).toBe('maxmustermann')
    expect(normalizeDisplayName('maxmustermann')).toBe('maxmustermann')
    expect(normalizeDisplayName('  Max Mustermann  ')).toBe('max mustermann')
    // Turkish-dotted capital I folds to i under simple toLowerCase, matching the spec formula
    expect(normalizeDisplayName('MAXI')).toBe('maxi')
  })

  it('NFKC-folds fullwidth look-alike letters to their ASCII forms', () => {
    // 'Ｍａｘ' is U+FF2D U+FF41 U+FF58 — fullwidth compatibility forms of "Max"
    expect(normalizeDisplayName('Ｍａｘ')).toBe('max')
    expect(normalizeDisplayName('Ｍａｘ')).toBe(normalizeDisplayName('max'))
  })

  it('NFKC-folds the fi ligature and circled letters', () => {
    // U+FB01 LATIN SMALL LIGATURE FI → "fi"; U+24DC CIRCLED LATIN SMALL LETTER M → "m"
    expect(normalizeDisplayName('ﬁn')).toBe('fin')
    expect(normalizeDisplayName('ⓜax')).toBe('max')
  })

  it('keeps distinct names distinct after normalization', () => {
    expect(normalizeDisplayName('Max M.')).not.toBe(normalizeDisplayName('Maxi M.'))
    expect(normalizeDisplayName('José')).toBe('josé') // diacritics are preserved, not folded away
  })
})
