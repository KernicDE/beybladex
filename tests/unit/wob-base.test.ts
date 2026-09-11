// tests/unit/wob-base.test.ts (RC10 #72)
// WoB is the canonical base ruleset: lib/wobBase holds its standard values (equal to the
// schema defaults / form defaults), detects per-field deviations and decides whether a
// ruleset IS the WoB standard — the flags the UI renders as badges.
import { describe, it, expect } from 'vitest'
import { WOB_BASE, WOB_TOGGLE_FIELDS, isWobStandard, wobDeviations } from '@/lib/wobBase'
import { buildRulesetProse } from '@/lib/rulesetProse'

const wobRuleset = { ...WOB_BASE }

describe('wobBase', () => {
  it('a ruleset with the base values in every field IS the WoB standard', () => {
    expect(isWobStandard(wobRuleset)).toBe(true)
    expect(wobDeviations(wobRuleset)).toEqual([])
  })

  it('flags every deviating field', () => {
    const deviant = { ...wobRuleset, allowForceSwitch: false, outOfBounds2Pts: false, targetPoints: 5 }
    expect(wobDeviations(deviant)).toEqual(['targetPoints', 'allowForceSwitch', 'outOfBounds2Pts'])
    expect(isWobStandard(deviant)).toBe(false)
  })

  it('covers exactly the seven boolean rule options plus the numeric settings', () => {
    expect(WOB_TOGGLE_FIELDS).toHaveLength(7)
    expect(WOB_TOGGLE_FIELDS.every((k) => typeof WOB_BASE[k] === 'boolean')).toBe(true)
    expect(typeof WOB_BASE.targetPoints).toBe('number')
    expect(typeof WOB_BASE.relaunchLimit).toBe('number')
  })

  it('stays in sync with the form defaults (a new ruleset starts as WoB standard)', async () => {
    const { DEFAULT_RULESET_VALUES } = await import('@/components/rules/RulesetForm')
    expect(DEFAULT_RULESET_VALUES.deckFormat).toBe(WOB_BASE.deckFormat)
    expect(Number(DEFAULT_RULESET_VALUES.targetPoints)).toBe(WOB_BASE.targetPoints)
    expect(Number(DEFAULT_RULESET_VALUES.finalsTargetPoints)).toBe(WOB_BASE.finalsTargetPoints)
    expect(Number(DEFAULT_RULESET_VALUES.relaunchLimit)).toBe(WOB_BASE.relaunchLimit)
    for (const key of WOB_TOGGLE_FIELDS) {
      expect(DEFAULT_RULESET_VALUES[key]).toBe(WOB_BASE[key])
    }
  })
})

describe('buildRulesetProse deviation flags', () => {
  it('marks only the options deviating from WoB', () => {
    const prose = buildRulesetProse({ ...wobRuleset, allowForceSwitch: false })
    const byLabel = Object.fromEntries(prose.map((p) => [p.label, p]))
    expect(byLabel['Force-Switch erlaubt'].deviates).toBe(true)
    expect(byLabel['Force-Switch erlaubt'].value).toBe(false)
    expect(byLabel['Gesperrte Decks'].deviates).toBe(false)
    expect(prose.filter((p) => p.deviates)).toHaveLength(1)
  })

  it('keeps the explanatory paragraph for every option', () => {
    const prose = buildRulesetProse(wobRuleset)
    expect(prose).toHaveLength(7)
    for (const entry of prose) {
      expect(entry.paragraph.length).toBeGreaterThan(50)
    }
  })
})
