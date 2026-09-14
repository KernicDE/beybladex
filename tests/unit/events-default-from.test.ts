// tests/unit/events-default-from.test.ts
// Live-Report ("wann verschwinden Turniere aus der Liste?"): resolveEffectiveFrom (lib/
// eventsDefaultFrom.ts) ist die Kernregel des Fixes — ohne explizites "Von" gilt "heute und
// später", ein explizit gesetztes (auch vergangenes) "Von" wird respektiert.
import { describe, it, expect } from 'vitest'
import { resolveEffectiveFrom } from '@/lib/eventsDefaultFrom'

const TODAY = '2026-09-14'

describe('resolveEffectiveFrom', () => {
  it('fällt ohne "Von"-Param auf heute zurück', () => {
    expect(resolveEffectiveFrom(undefined, TODAY)).toBe(TODAY)
  })

  it('respektiert ein explizites zukünftiges "Von"', () => {
    expect(resolveEffectiveFrom('2026-12-24', TODAY)).toBe('2026-12-24')
  })

  it('respektiert ein explizites VERGANGENES "Von" — "nur wenn explizit ein Filter passt" darf Vergangenes zeigen', () => {
    expect(resolveEffectiveFrom('2020-01-01', TODAY)).toBe('2020-01-01')
  })

  it('ignoriert ein missgebildetes "Von" (fällt auf heute zurück statt zu crashen)', () => {
    expect(resolveEffectiveFrom('nicht-ein-datum', TODAY)).toBe(TODAY)
    expect(resolveEffectiveFrom('24.12.2026', TODAY)).toBe(TODAY)
    expect(resolveEffectiveFrom('', TODAY)).toBe(TODAY)
  })
})
