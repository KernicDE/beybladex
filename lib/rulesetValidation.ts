// lib/rulesetValidation.ts
// Whitelisted-field validation shared by POST /api/rulesets and PATCH /api/rulesets/[slug].
// Every accepted field maps 1:1 to a Ruleset column — no invented fields, no mass assignment:
// anything not listed here is ignored, and a body with zero recognized fields is rejected.
import { DECK_FORMATS } from '@/lib/rulesetLabels'
import type { DeckFormat } from '@prisma/client'

const TITLE_MAX = 100
const DESCRIPTION_MAX = 1000
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

const BOOLEAN_FIELDS = [
  'isPublic',
  'lockedDecks',
  'allowForceSwitch',
  'arenaTurnAllowed',
  'outOfBounds2Pts',
  'ownFinishPenalty',
  'aerialContactRerun',
  'externalDisturbanceRerun',
] as const

// `partial = true` is PATCH semantics: every field optional, but a recognized field with a
// wrong type is an error (not silently dropped). `partial = false` is POST: title required.
export function parseRulesetInput(body: unknown, partial: false): RulesetInput & { data: RulesetInputData & { title: string } }
export function parseRulesetInput(body: unknown, partial: true): RulesetInput
export function parseRulesetInput(body: unknown, partial: boolean): RulesetInput {
  const result: RulesetInput = { data: {}, errors: [] }
  if (typeof body !== 'object' || body === null) {
    result.errors.push('invalid_body')
    return result
  }
  const fields = body as Record<string, unknown>

  if (fields.title !== undefined || !partial) {
    const title = fields.title
    if (typeof title !== 'string' || title.trim().length === 0 || title.length > TITLE_MAX) {
      result.errors.push('invalid_title')
    } else {
      result.data.title = title.trim()
    }
  }

  if (fields.description !== undefined) {
    const description = fields.description
    if (description !== null && (typeof description !== 'string' || description.length > DESCRIPTION_MAX)) {
      result.errors.push('invalid_description')
    } else {
      result.data.description = description
    }
  }

  if (fields.deckFormat !== undefined) {
    const deckFormat = fields.deckFormat
    if (typeof deckFormat !== 'string' || !(DECK_FORMATS as string[]).includes(deckFormat)) {
      result.errors.push('invalid_deck_format')
    } else {
      result.data.deckFormat = deckFormat as DeckFormat
    }
  }

  for (const key of ['targetPoints', 'finalsTargetPoints'] as const) {
    if (fields[key] === undefined) continue
    const value = fields[key]
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < POINTS_MIN ||
      value > POINTS_MAX
    ) {
      result.errors.push('invalid_points')
    } else {
      result.data[key] = value
    }
  }

  if (fields.relaunchLimit !== undefined) {
    const value = fields.relaunchLimit
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > RELAUNCH_MAX) {
      result.errors.push('invalid_relaunch_limit')
    } else {
      result.data.relaunchLimit = value
    }
  }

  for (const key of BOOLEAN_FIELDS) {
    if (fields[key] === undefined) continue
    if (typeof fields[key] !== 'boolean') {
      result.errors.push('invalid_boolean')
    } else {
      result.data[key] = fields[key]
    }
  }

  if (partial && Object.keys(result.data).length === 0) {
    result.errors.push('no_fields')
  }
  return result
}
