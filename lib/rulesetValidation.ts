// lib/rulesetValidation.ts (RC4 #55: schema-driven via lib/parseBody.ts)
// Whitelisted-field validation shared by POST /api/rulesets and PATCH /api/rulesets/[slug].
// Every accepted field maps 1:1 to a Ruleset column — no invented fields, no mass assignment:
// anything not listed in the schema is ignored (and warned about, see lib/parseBody.ts), and
// a body with zero recognized fields is rejected.
import { parseBody, type BodySchema } from '@/lib/parseBody'
import { DECK_FORMATS } from '@/lib/rulesetLabels'
import { RULESET_DESCRIPTION_MAX as DESCRIPTION_MAX } from '@/lib/markdownFieldCaps'
import type { DeckFormat } from '@prisma/client'

const TITLE_MAX = 100
const POINTS_MIN = 1
const POINTS_MAX = 100
const RELAUNCH_MAX = 10

// Explicit field-by-field shape — assignable to both RulesetUncheckedCreateInput and
// RulesetUncheckedUpdateInput without the union-type collapse of a Prisma.XInput | Prisma.YInput.
export type RulesetInputData = {
  title?: string
  description?: string | null
  isPublic?: boolean
  deckFormat?: DeckFormat
  targetPoints?: number
  finalsTargetPoints?: number
  relaunchLimit?: number
  lockedDecks?: boolean
  allowForceSwitch?: boolean
  arenaTurnAllowed?: boolean
  outOfBounds2Pts?: boolean
  ownFinishPenalty?: boolean
  aerialContactRerun?: boolean
  externalDisturbanceRerun?: boolean
}

export type RulesetInput = {
  data: RulesetInputData
  errors: string[]
}

// The nine boolean toggles share the historical `invalid_boolean` token — token overrides
// below keep that contract exact. Titles reject oversize input (maxError), they don't slice.
const RULESET_SCHEMA: BodySchema = {
  title: { type: 'string', trim: true, maxLength: TITLE_MAX, maxError: true, required: true, token: 'invalid_title' },
  description: { type: 'string', maxLength: DESCRIPTION_MAX, maxError: true, nullable: true, token: 'invalid_description' },
  isPublic: { type: 'boolean', token: 'invalid_boolean' },
  deckFormat: { type: 'enum', enum: DECK_FORMATS, token: 'invalid_deck_format' },
  targetPoints: { type: 'integer', min: POINTS_MIN, max: POINTS_MAX, token: 'invalid_points' },
  finalsTargetPoints: { type: 'integer', min: POINTS_MIN, max: POINTS_MAX, token: 'invalid_points' },
  relaunchLimit: { type: 'integer', min: 0, max: RELAUNCH_MAX, token: 'invalid_relaunch_limit' },
  lockedDecks: { type: 'boolean', token: 'invalid_boolean' },
  allowForceSwitch: { type: 'boolean', token: 'invalid_boolean' },
  arenaTurnAllowed: { type: 'boolean', token: 'invalid_boolean' },
  outOfBounds2Pts: { type: 'boolean', token: 'invalid_boolean' },
  ownFinishPenalty: { type: 'boolean', token: 'invalid_boolean' },
  aerialContactRerun: { type: 'boolean', token: 'invalid_boolean' },
  externalDisturbanceRerun: { type: 'boolean', token: 'invalid_boolean' },
}

// `partial = true` is PATCH semantics: every field optional, but a recognized field with a
// wrong type is an error (not silently dropped). `partial = false` is POST: title required.
export function parseRulesetInput(body: unknown, partial: false): RulesetInput & { data: RulesetInputData & { title: string } }
export function parseRulesetInput(body: unknown, partial: true): RulesetInput
export function parseRulesetInput(body: unknown, partial: boolean): RulesetInput {
  const { data, errors } = parseBody(body, RULESET_SCHEMA, { partial })
  if (partial && Object.keys(data).length === 0) {
    errors.push('no_fields')
  }
  return { data: data as RulesetInputData, errors }
}
