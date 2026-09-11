// lib/buildInput.ts (Phase 11; RC4 #55: schema-driven via lib/parseBody.ts)
// Shared input parsing for creating a Build from three part references (POST /api/builds —
// any logged-in user's personal combo; POST /api/admin/builds — curator direct-create of an
// official Set; CatalogProposal kind=BUILD payloads). The shape is validated here so all
// three paths enforce exactly the same fields.
import { parseBody, type BodySchema } from '@/lib/parseBody'

const SET_NAME_MAX = 160
const PRODUCT_CODE_MAX = 32

const BEY_TYPES = ['ATTACK', 'DEFENSE', 'STAMINA', 'BALANCE'] as const

// Which catalog category each build slot demands — the route verifies the referenced Part
// actually belongs to the slot (never trusting the client's slot label).
export const SLOT_CATEGORY = { bladeId: 'BLADE', ratchetId: 'RATCHET', bitId: 'BIT' } as const
export const BUILD_SLOTS = ['bladeId', 'ratchetId', 'bitId'] as const

export interface BuildInput {
  bladeId: string
  ratchetId: string
  bitId: string
  type: (typeof BEY_TYPES)[number] | null
  name: string | null
  productCode: string | null
}

// The three slot ids are required non-empty strings; type/name tolerate absence as an
// explicit null (the Build columns default to null). The Set `name`/`productCode` fields are
// only in the schema for official creates — user combos force them back to null below (a
// personal combo is not a retail product and has no manufacturer SKU).
function buildSchema(official: boolean): BodySchema {
  return {
    bladeId: { type: 'string', minLength: 1, required: true, token: 'invalid_bladeId' },
    ratchetId: { type: 'string', minLength: 1, required: true, token: 'invalid_ratchetId' },
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

/** Parses a build-create payload. `official` allows the Set name/productCode fields (only
 *  meaningful for isOfficialSet=true creates; user combos never carry one). Returns `{ data }`
 *  or `{ errors }`. */
export function parseBuildInput(body: unknown, opts: { official: boolean }): { data?: BuildInput; errors?: string[] } {
  const { data, errors } = parseBody(body, buildSchema(opts.official), { partial: false })
  if (errors.length > 0) return { errors }
  const input = data as unknown as BuildInput
  if (!opts.official) {
    input.name = null
    input.productCode = null
  }
  return { data: input }
}

/** Verifies that the three referenced parts exist AND sit in the slot's category.
 *  Returns the verified parts (id → { category, name }) or an error token. The name is
 *  included so creation call sites can derive the canonical Build name (Phase 20). */
export async function verifyBuildParts(
  prisma: {
    part: {
      findMany(args: {
        where: { id: { in: string[] } }
        select: { id: true; category: true; name: true }
      }): Promise<{ id: string; category: string; name: string }[]>
    }
  },
  input: Pick<BuildInput, 'bladeId' | 'ratchetId' | 'bitId'>,
): Promise<{ error: string } | { parts: Map<string, { id: string; category: string; name: string }> }> {
  const ids = [input.bladeId, input.ratchetId, input.bitId]
  const found = await prisma.part.findMany({ where: { id: { in: ids } }, select: { id: true, category: true, name: true } })
  const byId = new Map(found.map((p) => [p.id, p]))
  for (const slot of BUILD_SLOTS) {
    const id = input[slot]
    const part = byId.get(id)
    if (!part) return { error: `unknown_${slot}` }
    if (part.category !== SLOT_CATEGORY[slot]) return { error: `invalid_${slot}` }
  }
  return { parts: byId }
}
