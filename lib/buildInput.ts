// lib/buildInput.ts (Phase 11; RC4 #55: schema-driven via lib/parseBody.ts)
// Shared input parsing for creating a Build from part references (POST /api/builds — any
// logged-in user's personal combo; POST /api/admin/builds — curator direct-create of an
// official Set; CatalogProposal kind=BUILD payloads). The shape is validated here so all
// three paths enforce exactly the same fields.
//
// RC16 (#122) — variable slot model: das alte feste 3-Slot-Modell (blade+ratchet+bit) deckt
// zwei Produktfamilien nicht ab. Neues Regelwerk (verifiziert in verifyBuildParts):
//   • Blade-Assembly: ENTWEDER genau ein BLADE-Teil (Standard / Ratchet-Integrated)
//     ODER alle vier Custom-Line-Teile (lockChip + overBlade + metalBlade + assistBlade).
//   • bitId ist in jeder Bauform Pflicht.
//   • ratchetId Pflicht, AUSSER das Blade-Teil trägt isRatchetIntegrated (dann verboten).
import { parseBody, type BodySchema, type FieldSpec } from '@/lib/parseBody'

const SET_NAME_MAX = 160
const PRODUCT_CODE_MAX = 32

const BEY_TYPES = ['ATTACK', 'DEFENSE', 'STAMINA', 'BALANCE'] as const

// Which catalog category each build slot demands — the route verifies the referenced Part
// actually belongs to the slot (never trusting the client's slot label).
export const SLOT_CATEGORY = {
  bladeId: 'BLADE',
  lockChipId: 'LOCK_CHIP',
  overBladeId: 'OVER_BLADE',
  metalBladeId: 'METAL_BLADE',
  assistBladeId: 'ASSIST_BLADE',
  ratchetId: 'RATCHET',
  bitId: 'BIT',
} as const
export const BUILD_SLOTS = ['bladeId', 'lockChipId', 'overBladeId', 'metalBladeId', 'assistBladeId', 'ratchetId', 'bitId'] as const
// RC16 (#122) — Custom Line: die vier Blade-Stack-Slots, immer komplett oder gar nicht.
export const CUSTOM_LINE_SLOTS = ['lockChipId', 'overBladeId', 'metalBladeId', 'assistBladeId'] as const

export type BuildSlot = (typeof BUILD_SLOTS)[number]

export interface BuildInput {
  bladeId: string | null
  lockChipId: string | null
  overBladeId: string | null
  metalBladeId: string | null
  assistBladeId: string | null
  ratchetId: string | null
  bitId: string
  type: (typeof BEY_TYPES)[number] | null
  name: string | null
  productCode: string | null
}

type SlotFieldSpec = FieldSpec

// bitId is the only universally required slot. bladeId and ratchetId tolerate absence as an
// explicit null — absence is legal exactly when a complete Custom-Line stack carries the blade
// (CX) resp. the blade integrates the ratchet (decided against the DB part in verifyBuildParts,
// the parser itself is DB-free). The Set `name`/`productCode` fields are only in the schema for
// official creates — user combos force them back to null below (a personal combo is not a
// retail product and has no manufacturer SKU).
function buildSchema(official: boolean): BodySchema {
  const slot = (token: string): SlotFieldSpec => ({ type: 'string', minLength: 1, nullable: true, absentNull: true, token })
  return {
    bladeId: slot('invalid_bladeId'),
    lockChipId: slot('invalid_lockChipId'),
    overBladeId: slot('invalid_overBladeId'),
    metalBladeId: slot('invalid_metalBladeId'),
    assistBladeId: slot('invalid_assistBladeId'),
    ratchetId: slot('invalid_ratchetId'),
    bitId: { type: 'string', minLength: 1, required: true, token: 'invalid_bitId' },
    type: { type: 'enum', enum: BEY_TYPES, nullable: true, absentNull: true, token: 'invalid_type' },
    ...(official
      ? {
          name: { type: 'string', trim: true, maxLength: SET_NAME_MAX, nullable: true, absentNull: true, token: 'invalid_name' },
          productCode: {
            type: 'string',
            trim: true,
            maxLength: PRODUCT_CODE_MAX,
            nullable: true,
            absentNull: true,
            token: 'invalid_productCode',
          },
        }
      : {}),
  }
}

/** Structural blade-assembly rule (DB-free, so parse-time): genau EINE Blade-Form —
 *  einzelnes BLADE-Teil ODER kompletter Vierer-CX-Stack; ein Teil-Stack wird abgelehnt. */
function bladeAssemblyErrors(input: BuildInput): string[] {
  const cxPresent = CUSTOM_LINE_SLOTS.filter((s) => input[s] !== null).length
  if (input.bladeId !== null && cxPresent > 0) return ['invalid_bladeId']
  if (input.bladeId === null && cxPresent !== CUSTOM_LINE_SLOTS.length) {
    // Weder Blade noch vollständiger CX-Stack — fehlende CX-Slots benennen, sonst reicht invalid_bladeId.
    if (cxPresent > 0) return CUSTOM_LINE_SLOTS.filter((s) => input[s] === null).map((s) => `invalid_${s}`)
    return ['invalid_bladeId']
  }
  return []
}

/** Parses a build-create payload. `official` allows the Set name/productCode fields (only
 *  meaningful for isOfficialSet=true creates; user combos never carry one). Returns `{ data }`
 *  or `{ errors }`. */
export function parseBuildInput(body: unknown, opts: { official: boolean }): { data?: BuildInput; errors?: string[] } {
  const { data, errors } = parseBody(body, buildSchema(opts.official), { partial: false })
  // Auch bei Feld-Fehlern liefert data die gültigen Felder — über die null-Auffüllung mergen,
  // damit die strukturelle Regel auf dem tatsächlichen Payload arbeitet, nicht auf leer.
  const input = {
    bladeId: null,
    lockChipId: null,
    overBladeId: null,
    metalBladeId: null,
    assistBladeId: null,
    ratchetId: null,
    bitId: null,
    type: null,
    name: null,
    productCode: null,
    ...data,
  } as unknown as BuildInput
  if (!opts.official) {
    input.name = null
    input.productCode = null
  }
  // Strukturelle Blade-Assembly-Regel wird MIT den Feld-Fehlern zurückgegeben (ein Caller
  // sieht das volle Bild), nie stattdessen.
  const structural = bladeAssemblyErrors(input)
  if (errors.length > 0 || structural.length > 0) return { errors: [...errors, ...structural] }
  return { data: input }
}

/** The full 7-slot combo of a build input, nulls preserved (null = "kein Teil in diesem Slot").
 *  Usable as a Prisma where/create object: Prisma translates a null field to IS NULL, so
 *  findFirst with this object matches the exact combo even for 2-slot (ratchet-integrated)
 *  and 6-slot (Custom Line) builds. */
export function comboWhere(input: Pick<BuildInput, BuildSlot>) {
  return {
    bladeId: input.bladeId,
    lockChipId: input.lockChipId,
    overBladeId: input.overBladeId,
    metalBladeId: input.metalBladeId,
    assistBladeId: input.assistBladeId,
    ratchetId: input.ratchetId,
    bitId: input.bitId,
  }
}

/** Verifies that the referenced parts exist AND sit in the slot's category, plus the RC16
 *  (#122) blade-assembly and ratchet rules. Returns the verified parts (id → part) or an
 *  error token. The name is included so creation call sites can derive the canonical Build
 *  name (Phase 20); isRatchetIntegrated decides the ratchet rule. */
export async function verifyBuildParts(
  prisma: {
    part: {
      findMany(args: {
        where: { id: { in: string[] } }
        select: { id: true; category: true; name: true; isRatchetIntegrated: true }
      }): Promise<{ id: string; category: string; name: string; isRatchetIntegrated: boolean }[]>
    }
  },
  input: Pick<BuildInput, BuildSlot>,
): Promise<{ error: string } | { parts: Map<string, { id: string; category: string; name: string; isRatchetIntegrated: boolean }> }> {
  const ids = BUILD_SLOTS.map((s) => input[s]).filter((id): id is string => id !== null)
  const found = await prisma.part.findMany({ where: { id: { in: ids } }, select: { id: true, category: true, name: true, isRatchetIntegrated: true } })
  const byId = new Map(found.map((p) => [p.id, p]))
  for (const slot of BUILD_SLOTS) {
    const id = input[slot]
    if (id === null) continue // RC16 — leere Slots (CX-Blade, integriertes Ratchet) sind legal
    const part = byId.get(id)
    if (!part) return { error: `unknown_${slot}` }
    if (part.category !== SLOT_CATEGORY[slot]) return { error: `invalid_${slot}` }
  }
  // Ratchet-Regel: Pflicht außer das Blade-Teil integriert das Ratchet — dann verboten.
  // (Für CX-Builds ist input.bladeId null → isRatchetIntegrated undefined → Ratchet Pflicht.)
  const bladePart = input.bladeId !== null ? byId.get(input.bladeId) : undefined
  if (bladePart?.isRatchetIntegrated) {
    if (input.ratchetId !== null) return { error: 'ratchet_not_allowed' }
  } else if (input.ratchetId === null) {
    return { error: 'ratchet_required' }
  }
  return { parts: byId }
}
