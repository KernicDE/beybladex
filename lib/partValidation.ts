// lib/partValidation.ts (Phase 5 Part A)
// Shared input parsing for the parts-catalog curation API (POST/PATCH /api/admin/parts).
// Everything is validated here so both methods enforce exactly the same shape.
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
  imageUrl: string | null
  metadata: Record<string, unknown> | null
}

export interface PartRequestInput {
  name: string
  manufacturerGuess: (typeof MANUFACTURERS)[number] | null
  notes: string | null
}

function takeString(body: Record<string, unknown>, key: string, max: number): string | null | undefined {
  const v = body[key]
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  if (trimmed.length === 0) return null
  return trimmed.slice(0, max)
}

function isEnumValue<T extends string>(values: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (values as readonly string[]).includes(v)
}

/** Parses a Part payload. Returns `{ data }` or `{ errors }`; `partial` allows PATCH-style
 *  sparse bodies (only present keys are validated and returned). */
export function parsePartInput(body: unknown, partial: boolean): { data?: Partial<PartInput>; errors?: string[] } {
  if (typeof body !== 'object' || body === null) return { errors: ['invalid_body'] }
  const b = body as Record<string, unknown>
  const errors: string[] = []
  const data: Partial<PartInput> = {}

  const name = takeString(b, 'name', NAME_MAX)
  if (!partial || name !== undefined) {
    if (!name) errors.push('invalid_name')
    else data.name = name
  }

  const manufacturer = b.manufacturer
  if (!partial || manufacturer !== undefined) {
    if (!isEnumValue(MANUFACTURERS, manufacturer)) errors.push('invalid_manufacturer')
    else data.manufacturer = manufacturer
  }

  const category = b.category
  if (!partial || category !== undefined) {
    if (!isEnumValue(CATEGORIES, category)) errors.push('invalid_category')
    else data.category = category
  }

  if (b.beyType !== undefined || !partial) {
    if (b.beyType === null) data.beyType = null
    else if (isEnumValue(BEY_TYPES, b.beyType)) data.beyType = b.beyType
    else errors.push('invalid_beyType')
  }

  const spinDirection = b.spinDirection
  if (!partial || spinDirection !== undefined) {
    if (!isEnumValue(SPIN_DIRECTIONS, spinDirection)) errors.push('invalid_spinDirection')
    else data.spinDirection = spinDirection
  }

  if (b.weightGrams !== undefined || !partial) {
    if (b.weightGrams === null) data.weightGrams = null
    else if (typeof b.weightGrams === 'number' && Number.isFinite(b.weightGrams) && b.weightGrams > 0 && b.weightGrams < 1000) {
      data.weightGrams = b.weightGrams
    } else errors.push('invalid_weightGrams')
  }

  const imageUrl = takeString(b, 'imageUrl', 500)
  if (imageUrl !== undefined) {
    // Catalog images are local files under /public — no external URLs (zero-CDN guarantee).
    if (imageUrl !== null && !imageUrl.startsWith('/')) errors.push('invalid_imageUrl')
    else data.imageUrl = imageUrl
  }

  if (b.metadata !== undefined || !partial) {
    if (b.metadata === null) data.metadata = null
    else if (typeof b.metadata === 'object' && !Array.isArray(b.metadata)) data.metadata = b.metadata as Record<string, unknown>
    else errors.push('invalid_metadata')
  }

  return errors.length > 0 ? { errors } : { data }
}

/** Parses a "request missing part" payload (POST /api/parts/request). */
export function parsePartRequestInput(body: unknown): { data?: PartRequestInput; errors?: string[] } {
  if (typeof body !== 'object' || body === null) return { errors: ['invalid_body'] }
  const b = body as Record<string, unknown>
  const errors: string[] = []

  const name = takeString(b, 'name', NAME_MAX)
  if (!name) errors.push('invalid_name')

  let manufacturerGuess: PartRequestInput['manufacturerGuess'] = null
  if (b.manufacturerGuess !== undefined && b.manufacturerGuess !== null) {
    if (!isEnumValue(MANUFACTURERS, b.manufacturerGuess)) errors.push('invalid_manufacturerGuess')
    else manufacturerGuess = b.manufacturerGuess
  }

  const notes = takeString(b, 'notes', 500)

  return errors.length > 0 ? { errors } : { data: { name: name!, manufacturerGuess, notes: notes ?? null } }
}
