// tests/unit/ruleset-slug.test.ts
// Pure slug-generation logic for rulesets (lib/slug.ts) — no DB required.
import { describe, it, expect } from 'vitest'
import { slugify, uniqueSlug } from '@/lib/slug'

describe('slugify', () => {
  it('produces URL-safe, lowercase, dash-separated slugs', () => {
    expect(slugify('Mein cooles Regelwerk!')).toBe('mein-cooles-regelwerk')
    expect(slugify('WBO Finale 2026')).toBe('wbo-finale-2026')
  })

  it('is deterministic — the same title always yields the same slug', () => {
    const title = '3on3 Arena Cup #12'
    expect(slugify(title)).toBe(slugify(title))
  })

  it('transliterates German umlauts and ß readably', () => {
    expect(slugify('Müller Öde Straße')).toBe('mueller-oede-strasse')
  })

  it('strips diacritics from other Latin scripts', () => {
    expect(slugify('Café Règle')).toBe('cafe-regle')
  })

  it('collapses separators and trims leading/trailing dashes', () => {
    expect(slugify('--a__b  c--')).toBe('a-b-c')
  })

  it('never returns an empty slug', () => {
    expect(slugify('')).toBe('regelwerk')
    expect(slugify('!!!')).toBe('regelwerk')
    expect(slugify('日本語')).toBe('regelwerk')
  })

  it('keeps the slug within the max length', () => {
    const long = 'x'.repeat(200)
    expect(slugify(long)).toHaveLength(60)
  })
})

describe('uniqueSlug', () => {
  const takenSet = (slugs: string[]) => {
    const set = new Set(slugs)
    return async (slug: string) => set.has(slug)
  }

  it('returns the base slug when free', async () => {
    expect(await uniqueSlug('mein-regelwerk', takenSet([]))).toBe('mein-regelwerk')
  })

  it('appends -2, -3, … on collisions', async () => {
    const isTaken = takenSet(['mein-regelwerk', 'mein-regelwerk-2'])
    expect(await uniqueSlug('mein-regelwerk', isTaken)).toBe('mein-regelwerk-3')
  })

  it('returns base-2 on the first collision', async () => {
    const isTaken = takenSet(['mein-regelwerk'])
    expect(await uniqueSlug('mein-regelwerk', isTaken)).toBe('mein-regelwerk-2')
  })
})
