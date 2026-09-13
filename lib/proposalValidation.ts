// lib/proposalValidation.ts (Phase 11, item 1; RC4 #55: schema-driven via lib/parseBody.ts)
// Structured CatalogProposal payload parsing, extending lib/partValidation.ts's pattern
// (whitelisted fields, snake_case error tokens, `{ data } | { errors }` shape). The payload
// is validated BY KIND at the route layer — never accepted as opaque JSON:
//   kind=PART  → a full Part create shape (name, manufacturer, category, weight,
//                spin direction, beyType — plus an optional MediaAsset uploaded with the form)
//   kind=BUILD → a Set name plus three slots, each either an existing Part.id or an
//                inline-new Part shape with the slot's category forced
//
// The flat inline-part shape is a lib/parseBody.ts schema instantiated per call site with
// the error-token prefix (`part` / `slot_blade` / …) the historical parser emitted. The
// slot UNION (existing partId XOR inline-new shape) stays custom — a union doesn't fit a
// flat field spec; everything flat goes through the engine.
export { CURATOR_ROLES, isCurator } from '@/lib/roles'

import { parseBody, type BodySchema } from '@/lib/parseBody'

const SET_NAME_MAX = 160
const NOTES_MAX = 500

const MANUFACTURERS = ['TT', 'HASBRO'] as const
const BEY_TYPES = ['ATTACK', 'DEFENSE', 'STAMINA', 'BALANCE'] as const
const SPIN_DIRECTIONS = ['RIGHT', 'LEFT'] as const
export const PROPOSAL_CATEGORIES = ['BLADE', 'RATCHET', 'BIT', 'ACCESSORY', 'LOCK_CHIP', 'OVER_BLADE', 'METAL_BLADE', 'ASSIST_BLADE'] as const
// RC16 (#122) — variable Slot-Modell: 'blade' XOR alle vier 'customLine'-Slots; 'ratchet'
// bedingt optional (fehlt bei Ratchet-Integrated-Blades; das entscheidet der Approval anhand
// von Part.isRatchetIntegrated, der Payload-Parser kennt die DB nicht).
export const PROPOSAL_SLOT_CATEGORIES = {
  blade: 'BLADE',
  lockChip: 'LOCK_CHIP',
  overBlade: 'OVER_BLADE',
  metalBlade: 'METAL_BLADE',
  assistBlade: 'ASSIST_BLADE',
  ratchet: 'RATCHET',
  bit: 'BIT',
} as const
export const PROPOSAL_CUSTOM_LINE_SLOTS = ['lockChip', 'overBlade', 'metalBlade', 'assistBlade'] as const
export type ProposalSlot = keyof typeof PROPOSAL_SLOT_CATEGORIES

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
  // Pflicht-Slots blade + bit; ratchet bedingt optional (RC16 #122); die vier CX-Slots
  // komplett oder gar nicht — Vollständigkeit prüft parseBuildProposalPayload.
  slots: Record<'blade' | 'ratchet' | 'bit', BuildSlotPayload> & Partial<Record<(typeof PROPOSAL_CUSTOM_LINE_SLOTS)[number], BuildSlotPayload>>
}

export type ProposalPayload = PartProposalPayload | BuildProposalPayload

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// The inline-new Part shape, instantiated per call site so error tokens carry the prefix the
// old hand parser used (invalid_part_name / invalid_slot_blade_name / …). All fields were
// POST-style required except beyType/weightGrams, which tolerate absence AND explicit null.
function inlinePartSchema(prefix: string): BodySchema {
  return {
    name: { type: 'string', trim: true, maxLength: 120, required: true, token: `invalid_${prefix}_name` },
    manufacturer: { type: 'enum', enum: MANUFACTURERS, required: true, token: `invalid_${prefix}_manufacturer` },
    beyType: { type: 'enum', enum: BEY_TYPES, nullable: true, token: `invalid_${prefix}_beyType` },
    spinDirection: { type: 'enum', enum: SPIN_DIRECTIONS, required: true, token: `invalid_${prefix}_spinDirection` },
    weightGrams: { type: 'number', gt: 0, lt: 1000, nullable: true, token: `invalid_${prefix}_weightGrams` },
  }
}

function parseInlinePart(b: unknown, errors: string[], prefix: string): InlinePartPayload | null {
  // Non-record bodies keep the historical token (`invalid_<prefix>`, NOT invalid_body).
  if (!isRecord(b)) {
    errors.push(`invalid_${prefix}`)
    return null
  }
  // warnUnknown: false — this parses a SUBSET of the enclosing payload (category/notes or the
  // slots object belong to the outer shape); the outer parse owns unknown-field warnings.
  const { data, errors: fieldErrors } = parseBody(b, inlinePartSchema(prefix), { partial: false, warnUnknown: false })
  errors.push(...fieldErrors)
  if (fieldErrors.length > 0) return null
  return {
    name: data.name as string,
    manufacturer: data.manufacturer as InlinePartPayload['manufacturer'],
    beyType: (data.beyType ?? null) as InlinePartPayload['beyType'],
    spinDirection: data.spinDirection as InlinePartPayload['spinDirection'],
    weightGrams: (data.weightGrams ?? null) as number | null,
  }
}

/** Parses a kind=PART proposal payload (the fields FormData/JSON carry for a Part). */
export function parsePartProposalPayload(body: unknown): { data?: PartProposalPayload; errors?: string[] } {
  if (!isRecord(body)) return { errors: ['invalid_body'] }
  const errors: string[] = []
  const part = parseInlinePart(body, errors, 'part')
  // category is required; notes tolerate ANY garbage as null (the old takeString never
  // errored on a wrong-typed notes value).
  const { data, errors: fieldErrors } = parseBody(
    body,
    {
      category: { type: 'enum', enum: PROPOSAL_CATEGORIES, required: true, token: 'invalid_category' },
      notes: { type: 'string', trim: true, emptyNull: true, maxLength: NOTES_MAX, nullable: true, lenient: true, absentNull: true, token: 'invalid_notes' },
    },
    { partial: false, warnUnknown: false },
  )
  errors.push(...fieldErrors)
  if (!part || errors.length > 0) return { errors }
  return { data: { ...part, category: data.category as PartProposalPayload['category'], notes: (data.notes ?? null) as string | null } }
}

function parseBuildSlot(body: unknown, slot: ProposalSlot, errors: string[], allowEmpty: boolean): BuildSlotPayload {
  // Slot UNION (existing Part.id XOR inline-new part) — custom control flow, not a flat field.
  if (!isRecord(body)) {
    if (allowEmpty) return { partId: null, inline: null }
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
  if (allowEmpty) return { partId: null, inline: null }
  errors.push(`invalid_slot_${slot}`)
  return { partId: null, inline: null }
}

/** Parses a kind=BUILD proposal payload (Set name + variable Slots, RC16 #122). */
export function parseBuildProposalPayload(body: unknown): { data?: BuildProposalPayload; errors?: string[] } {
  if (!isRecord(body)) return { errors: ['invalid_body'] }
  const { data, errors } = parseBody(
    body,
    { name: { type: 'string', trim: true, maxLength: SET_NAME_MAX, required: true, token: 'invalid_name' } },
    { partial: false, warnUnknown: false },
  )
  const rawSlots = (body as Record<string, unknown>).slots
  if (!isRecord(rawSlots)) {
    errors.push('invalid_slots')
    return { errors }
  }
  const slots = {} as BuildProposalPayload['slots']
  // blade bleibt Pflicht, aber parse-seitig tolerant (leer = null), damit die CX-Präsenzregel
  // unten exakt einen Token liefert statt zwei. ratchet darf leer bleiben (Ratchet-Integrated-
  // Entscheidung fällt erst am Approval gegen die DB). Die CX-Slots sind optional, aber ein
  // Teil-Stack (irgendein CX-Slot gesetzt, nicht alle vier) wird als fehlende Slots benamt abgelehnt.
  slots.blade = parseBuildSlot(rawSlots.blade, 'blade', errors, true)
  slots.bit = parseBuildSlot(rawSlots.bit, 'bit', errors, false)
  slots.ratchet = parseBuildSlot(rawSlots.ratchet, 'ratchet', errors, true)
  const cxPresent = PROPOSAL_CUSTOM_LINE_SLOTS.filter((s) => rawSlots[s] !== undefined).length
  for (const slot of PROPOSAL_CUSTOM_LINE_SLOTS) {
    if (cxPresent === PROPOSAL_CUSTOM_LINE_SLOTS.length || rawSlots[slot] !== undefined) {
      slots[slot] = parseBuildSlot(rawSlots[slot], slot, errors, false)
    }
  }
  if (cxPresent > 0 && cxPresent < PROPOSAL_CUSTOM_LINE_SLOTS.length) {
    for (const slot of PROPOSAL_CUSTOM_LINE_SLOTS) {
      if (rawSlots[slot] === undefined) errors.push(`invalid_slot_${slot}`)
    }
  }
  // Blade-Assembly: bei CX muss der blade-Slot LEER sein (CX-Stack ersetzt das Blade-Teil);
  // ohne jeden CX-Slot muss blade belegt sein. Ein Teil-Stack benennt nur die fehlenden
  // CX-Slots — blade zusätzlich zu bemängeln wäre doppelte Fehlerfläche. Genau ein Token.
  if (cxPresent === PROPOSAL_CUSTOM_LINE_SLOTS.length) {
    if (slots.blade.partId !== null || slots.blade.inline !== null) errors.push('invalid_slot_blade')
  } else if (cxPresent === 0 && slots.blade.partId === null && slots.blade.inline === null) {
    errors.push('invalid_slot_blade')
  }
  return errors.length > 0 ? { errors } : { data: { name: data.name as string, slots } }
}
