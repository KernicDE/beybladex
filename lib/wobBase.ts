// lib/wobBase.ts (RC10 #72)
// The canonical WoB base ruleset — the ONE place the World-of-Beyblade standard values
// live. They intentionally equal the Prisma schema defaults and RulesetForm's
// DEFAULT_RULESET_VALUES (a new ruleset starts AS the WoB standard; every deliberate
// change is a deviation). Deviation helpers answer "wie weicht dieses Regelwerk von WoB
// ab?" for the UI: list badges (/rules) and per-toggle marks (ruleset detail).
import type { Ruleset } from '@prisma/client'

export const WOB_BASE = {
  deckFormat: 'WBO_COUNTERDECK',
  targetPoints: 4,
  finalsTargetPoints: 7,
  relaunchLimit: 1,
  lockedDecks: true,
  allowForceSwitch: true,
  arenaTurnAllowed: true,
  outOfBounds2Pts: true,
  ownFinishPenalty: true,
  aerialContactRerun: true,
  externalDisturbanceRerun: true,
} as const

export type WobField = keyof typeof WOB_BASE
export type WobComparableRuleset = Pick<Ruleset, WobField>

// Field keys compared per ruleset toggle (the boolean checklist on the detail page).
export const WOB_TOGGLE_FIELDS = [
  'lockedDecks',
  'allowForceSwitch',
  'arenaTurnAllowed',
  'outOfBounds2Pts',
  'ownFinishPenalty',
  'aerialContactRerun',
  'externalDisturbanceRerun',
] as const satisfies readonly WobField[]

export function wobDeviations(ruleset: WobComparableRuleset): WobField[] {
  return (Object.keys(WOB_BASE) as WobField[]).filter((key) => ruleset[key] !== WOB_BASE[key])
}

// True when the ruleset IS the WoB standard in every comparable field (no deviations).
export function isWobStandard(ruleset: WobComparableRuleset): boolean {
  return wobDeviations(ruleset).length === 0
}
