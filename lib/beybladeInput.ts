// lib/beybladeInput.ts (MVP4, #139/#141; RC4 #55: schema-driven via lib/parseBody.ts)
// Input parsing für Beyblade-Creates (offizielle Sets) — Curator-Pfade: POST /api/admin/builds
// (Direct Create) und die CatalogProposal-BUILD-Freigabe. Dieselbe Slot-Struktur und
// Validierung wie Builds via lib/assembly.ts; gegenüber dem Legacy-Build-Pfad (lib/buildInput.ts)
// ist der Set-Name HIER required (eine Beyblade ist ein Retail-Produkt mit Produktnamen) und
// manufacturer ein Pflichtfeld statt einer Backfill-Ableitung.
import { parseBody, type BodySchema, type FieldSpec } from '@/lib/parseBody'
import { bladeAssemblyErrors, type AssemblyInput } from '@/lib/assembly'

const NAME_MAX = 160
const PRODUCT_CODE_MAX = 32

const MANUFACTURERS = ['TT', 'HASBRO'] as const

export interface BeybladeInput extends AssemblyInput {
  name: string
  manufacturer: (typeof MANUFACTURERS)[number]
  productCode: string | null
}

function beybladeSchema(): BodySchema {
  const slot = (token: string): FieldSpec => ({ type: 'string', minLength: 1, nullable: true, absentNull: true, token })
  return {
    name: { type: 'string', trim: true, minLength: 1, maxLength: NAME_MAX, required: true, token: 'invalid_name' },
    manufacturer: { type: 'enum', enum: MANUFACTURERS, required: true, token: 'invalid_manufacturer' },
    productCode: { type: 'string', trim: true, maxLength: PRODUCT_CODE_MAX, nullable: true, absentNull: true, token: 'invalid_productCode' },
    bladeId: slot('invalid_bladeId'),
    lockChipId: slot('invalid_lockChipId'),
    overBladeId: slot('invalid_overBladeId'),
    metalBladeId: slot('invalid_metalBladeId'),
    assistBladeId: slot('invalid_assistBladeId'),
    ratchetId: slot('invalid_ratchetId'),
    bitId: { type: 'string', minLength: 1, required: true, token: 'invalid_bitId' },
  }
}

/** Parsed ein Beyblade-Create-Payload. Returns `{ data }` or `{ errors }`. */
export function parseBeybladeInput(body: unknown): { data?: BeybladeInput; errors?: string[] } {
  const { data, errors } = parseBody(body, beybladeSchema(), { partial: false })
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
    productCode: null,
    ...data,
  } as unknown as BeybladeInput
  // Strukturelle Blade-Assembly-Regel wird MIT den Feld-Fehlern zurückgegeben, nie stattdessen.
  const structural = bladeAssemblyErrors(input)
  if (errors.length > 0 || structural.length > 0) return { errors: [...errors, ...structural] }
  return { data: input }
}
