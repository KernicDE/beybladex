// lib/buildInput.ts (Phase 11; RC4 #55: schema-driven via lib/parseBody.ts; MVP4 #141)
// Input parsing for creating a Build from part references (POST /api/builds — any logged-in
// user's personal combo). Die Slot-Struktur und ALLE Validierungsregeln leben in der
// Assembly-Shared-Lib lib/assembly.ts (Beyblade UND Build nutzen dieselbe Logik — keine
// doppelte Drift-Stelle); diese Datei ist nur noch die parseBody-Schicht für den Build-Pfad
// (Beyblade-Creates parsen in lib/beybladeInput.ts).
//
// RC16 (#122) — variable Slot-Modell (Regelwerk siehe lib/assembly.ts):
//   • Blade-Assembly: ENTWEDER genau ein BLADE-Teil (Standard / Ratchet-Integrated)
//     ODER alle vier Custom-Line-Teile (lockChip + overBlade + metalBlade + assistBlade).
//   • bitId ist in jeder Bauform Pflicht.
//   • ratchetId Pflicht, AUSSER das Blade-Teil trägt isRatchetIntegrated (dann verboten).
import { parseBody, type BodySchema, type FieldSpec } from '@/lib/parseBody'
import { bladeAssemblyErrors, CUSTOM_LINE_SLOTS, type AssemblyInput, type AssemblySlot } from '@/lib/assembly'

const SET_NAME_MAX = 160
const PRODUCT_CODE_MAX = 32

const BEY_TYPES = ['ATTACK', 'DEFENSE', 'STAMINA', 'BALANCE'] as const

export { CUSTOM_LINE_SLOTS }
export type { AssemblySlot }
/** @deprecated Aliase auf lib/assembly.ts — kanonisch sind die Assembly-Namen (ASSEMBLY_SLOTS…). */
export const BUILD_SLOTS = ['bladeId', 'lockChipId', 'overBladeId', 'metalBladeId', 'assistBladeId', 'ratchetId', 'bitId'] as const

export interface BuildInput extends AssemblyInput {
  type: (typeof BEY_TYPES)[number] | null
  name: string | null
  productCode: string | null
}

type SlotFieldSpec = FieldSpec

// bitId is the only universally required slot. bladeId and ratchetId tolerate absence as an
// explicit null — absence is legal exactly when a complete Custom-Line stack carries the blade
// (CX) resp. the blade integrates the ratchet (decided against the DB part in
// verifyAssemblyParts, the parser itself is DB-free). The Set `name`/`productCode` fields are
// only in the schema for the legacy official create — user combos force them back to null
// below (a personal combo is not a retail product and has no manufacturer SKU).
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

/** Parses a build-create payload. `official` allows the legacy Set name/productCode fields
 *  (MVP4 #141: offizielle Sets sind Beyblades — dieser Pfad bleibt nur noch für
 *  Übergangs-Kompatibilität; Beyblade-Creates nutzen lib/beybladeInput.ts mit required name).
 *  Returns `{ data }` or `{ errors }`. */
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
