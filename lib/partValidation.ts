// lib/partValidation.ts (Phase 5 Part A; RC4 #55: schema-driven via lib/parseBody.ts)
// Shared input parsing for the parts-catalog curation API (POST/PATCH /api/admin/parts).
// Everything is validated here so both methods enforce exactly the same shape.
// Error tokens are API contract (tests assert invalid_manufacturer etc.) — the schema below
// pins each one explicitly.
import { parseBody, type BodySchema } from '@/lib/parseBody'

const NAME_MAX = 120

const MANUFACTURERS = ['TT', 'HASBRO'] as const
const CATEGORIES = ['BLADE', 'RATCHET', 'BIT', 'ACCESSORY'] as const
const BEY_TYPES = ['ATTACK', 'DEFENSE', 'STAMINA', 'BALANCE'] as const
const SPIN_DIRECTIONS = ['RIGHT', 'LEFT'] as const

export interface PartInput {
  name: string
  manufacturer: (typeof MANUFACTURERS)[number]
  category: (typeof CATEGORIES)[number]
  beyType: (typeof BEY_TYPES)[number] | null
  spinDirection: (typeof SPIN_DIRECTIONS)[number]
  weightGrams: number | null
  metadata: Record<string, unknown> | null
}

// POST validates EVERY field (absence errors — a Part create carries the full shape, with
// beyType/weightGrams/metadata explicitly nullable); PATCH (partial) skips absent keys but
// rejects a present key with a wrong type. name caps by slicing (the historical takeString),
// never errors on oversize.
const PART_SCHEMA: BodySchema = {
  name: { type: 'string', trim: true, maxLength: NAME_MAX, required: true, token: 'invalid_name' },
  manufacturer: { type: 'enum', enum: MANUFACTURERS, required: true, token: 'invalid_manufacturer' },
  category: { type: 'enum', enum: CATEGORIES, required: true, token: 'invalid_category' },
  beyType: { type: 'enum', enum: BEY_TYPES, required: true, nullable: true, token: 'invalid_beyType' },
  spinDirection: { type: 'enum', enum: SPIN_DIRECTIONS, required: true, token: 'invalid_spinDirection' },
  weightGrams: { type: 'number', gt: 0, lt: 1000, required: true, nullable: true, token: 'invalid_weightGrams' },
  metadata: { type: 'json', required: true, nullable: true, token: 'invalid_metadata' },
}

/** Parses a Part payload. Returns `{ data }` or `{ errors }`; `partial` allows PATCH-style
 *  sparse bodies (only present keys are validated and returned). */
export function parsePartInput(body: unknown, partial: boolean): { data?: Partial<PartInput>; errors?: string[] } {
  const { data, errors } = parseBody(body, PART_SCHEMA, { partial })
  return errors.length > 0 ? { errors } : { data: data as Partial<PartInput> }
}

// parsePartRequestInput (the old "request missing part" free-text validator) is gone —
// PartRequest was replaced by CatalogProposal in Phase 11; see lib/proposalValidation.ts.
