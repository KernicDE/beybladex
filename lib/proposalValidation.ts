// lib/proposalValidation.ts (Phase 11, item 1)
// Structured CatalogProposal payload parsing, extending lib/partValidation.ts's pattern
// (whitelisted fields, snake_case error tokens, `{ data } | { errors }` shape). The payload
// is validated BY KIND at the route layer — never accepted as opaque JSON:
//   kind=PART  → a full Part create shape (name, manufacturer, category, weight,
//                spin direction, beyType — plus an optional MediaAsset uploaded with the form)
//   kind=BUILD → a Set name plus three slots, each either an existing Part.id or an
//                inline-new Part shape with the slot's category forced
export { CURATOR_ROLES, isCurator } from '@/lib/roles'

const SET_NAME_MAX = 160
const NOTES_MAX = 500

const MANUFACTURERS = ['TT', 'HASBRO'] as const
const BEY_TYPES = ['ATTACK', 'DEFENSE', 'STAMINA', 'BALANCE'] as const
const SPIN_DIRECTIONS = ['RIGHT', 'LEFT'] as const
export const PROPOSAL_CATEGORIES = ['BLADE', 'RATCHET', 'BIT', 'ACCESSORY'] as const
export const PROPOSAL_SLOT_CATEGORIES = { blade: 'BLADE', ratchet: 'RATCHET', bit: 'BIT' } as const

export interface InlinePartPayload {
  name: string
  manufacturer: (typeof MANUFACTURERS)[number]
  beyType: (typeof BEY_TYPES)[number] | null
  spinDirection: (typeof SPIN_DIRECTIONS)[number]
  weightGrams: number | null
}

export interface BuildSlotPayload {
  partId: string | null
  inline: InlinePartPayload | null
}

export interface PartProposalPayload extends InlinePartPayload {
  category: (typeof PROPOSAL_CATEGORIES)[number]
  notes: string | null
}

export interface BuildProposalPayload {
  name: string
  slots: Record<keyof typeof PROPOSAL_SLOT_CATEGORIES, BuildSlotPayload>
}

export type ProposalPayload = PartProposalPayload | BuildProposalPayload

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function isEnumValue<T extends string>(values: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (values as readonly string[]).includes(v)
}

function takeString(b: Record<string, unknown>, key: string, max: number): string | null {
  const v = b[key]
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  return trimmed === '' ? null : trimmed.slice(0, max)
}

function parseInlinePart(b: unknown, errors: string[], prefix: string): InlinePartPayload | null {
  if (!isRecord(b)) {
    errors.push(`invalid_${prefix}`)
    return null
  }
  const part: InlinePartPayload = { name: '', manufacturer: 'TT', beyType: null, spinDirection: 'RIGHT', weightGrams: null }

  const name = takeString(b, 'name', 120)
  if (!name) errors.push(`invalid_${prefix}_name`)
  else part.name = name

  if (!isEnumValue(MANUFACTURERS, b.manufacturer)) errors.push(`invalid_${prefix}_manufacturer`)
  else part.manufacturer = b.manufacturer

  if (b.beyType !== undefined && b.beyType !== null) {
    if (!isEnumValue(BEY_TYPES, b.beyType)) errors.push(`invalid_${prefix}_beyType`)
    else part.beyType = b.beyType
  }

  if (!isEnumValue(SPIN_DIRECTIONS, b.spinDirection)) errors.push(`invalid_${prefix}_spinDirection`)
  else part.spinDirection = b.spinDirection

  if (b.weightGrams !== undefined && b.weightGrams !== null) {
    if (typeof b.weightGrams !== 'number' || !Number.isFinite(b.weightGrams) || b.weightGrams <= 0 || b.weightGrams >= 1000) {
      errors.push(`invalid_${prefix}_weightGrams`)
    } else part.weightGrams = b.weightGrams
  }

  return name ? part : null
}

/** Parses a kind=PART proposal payload (the fields FormData/JSON carry for a Part). */
export function parsePartProposalPayload(body: unknown): { data?: PartProposalPayload; errors?: string[] } {
  if (!isRecord(body)) return { errors: ['invalid_body'] }
  const errors: string[] = []
  const part = parseInlinePart(body, errors, 'part')
  let category: PartProposalPayload['category'] | null = null
  if (isEnumValue(PROPOSAL_CATEGORIES, body.category)) category = body.category
  else errors.push('invalid_category')
  if (!part || !category) return { errors }
  const notes = takeString(body, 'notes', NOTES_MAX)
  return { data: { ...part, category, notes } }
}

function parseBuildSlot(body: unknown, slot: keyof typeof PROPOSAL_SLOT_CATEGORIES, errors: string[]): BuildSlotPayload {
  if (!isRecord(body)) {
    errors.push(`invalid_slot_${slot}`)
    return { partId: null, inline: null }
  }
  const partId = body.partId
  const inline = body.inline
  if (typeof partId === 'string' && partId.length > 0) {
    // Existing catalog reference — the route verifies existence AND category.
    return { partId, inline: null }
  }
  if (isRecord(inline)) {
    return { partId: null, inline: parseInlinePart(inline, errors, `slot_${slot}`) }
  }
  errors.push(`invalid_slot_${slot}`)
  return { partId: null, inline: null }
}

/** Parses a kind=BUILD proposal payload (Set name + three slots). */
export function parseBuildProposalPayload(body: unknown): { data?: BuildProposalPayload; errors?: string[] } {
  if (!isRecord(body)) return { errors: ['invalid_body'] }
  const errors: string[] = []
  const name = takeString(body, 'name', SET_NAME_MAX)
  if (!name) errors.push('invalid_name')

  const rawSlots = body.slots
  if (!isRecord(rawSlots)) {
    errors.push('invalid_slots')
    return { errors }
  }
  const slots = {} as BuildProposalPayload['slots']
  for (const slot of Object.keys(PROPOSAL_SLOT_CATEGORIES) as (keyof typeof PROPOSAL_SLOT_CATEGORIES)[]) {
    slots[slot] = parseBuildSlot(rawSlots[slot], slot, errors)
  }

  return errors.length > 0 ? { errors } : { data: { name: name!, slots } }
}
