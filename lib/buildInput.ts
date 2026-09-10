// lib/buildInput.ts (Phase 11)
// Shared input parsing for creating a Build from three part references (POST /api/builds —
// any logged-in user's personal combo; POST /api/admin/builds — curator direct-create of an
// official Set; CatalogProposal kind=BUILD payloads). The shape is validated here so all
// three paths enforce exactly the same fields.
const SET_NAME_MAX = 160

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
}

function isEnumValue<T extends string>(values: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (values as readonly string[]).includes(v)
}

/** Parses a build-create payload. `official` allows the Set name field (only meaningful for
 *  isOfficialSet=true creates; user combos never carry one). Returns `{ data }` or `{ errors }`. */
export function parseBuildInput(body: unknown, opts: { official: boolean }): { data?: BuildInput; errors?: string[] } {
  if (typeof body !== 'object' || body === null) return { errors: ['invalid_body'] }
  const b = body as Record<string, unknown>
  const errors: string[] = []
  const data = {} as BuildInput

  for (const slot of BUILD_SLOTS) {
    const v = b[slot]
    if (typeof v !== 'string' || v.length === 0) errors.push(`invalid_${slot}`)
    else data[slot] = v
  }

  if (b.type === undefined || b.type === null) data.type = null
  else if (isEnumValue(BEY_TYPES, b.type)) data.type = b.type
  else errors.push('invalid_type')

  if (opts.official) {
    if (b.name === undefined || b.name === null) data.name = null
    else if (typeof b.name !== 'string' || b.name.trim().length === 0) errors.push('invalid_name')
    else data.name = b.name.trim().slice(0, SET_NAME_MAX)
  } else {
    data.name = null
  }

  return errors.length > 0 ? { errors } : { data }
}

/** Verifies that the three referenced parts exist AND sit in the slot's category.
 *  Returns the verified parts or an error token. */
export async function verifyBuildParts(
  prisma: {
    part: {
      findMany(args: {
        where: { id: { in: string[] } }
        select: { id: true; category: true }
      }): Promise<{ id: string; category: string }[]>
    }
  },
  input: Pick<BuildInput, 'bladeId' | 'ratchetId' | 'bitId'>,
): Promise<{ error: string } | { parts: Map<string, string> }> {
  const ids = [input.bladeId, input.ratchetId, input.bitId]
  const found = await prisma.part.findMany({ where: { id: { in: ids } }, select: { id: true, category: true } })
  const byId = new Map(found.map((p) => [p.id, p.category]))
  for (const slot of BUILD_SLOTS) {
    const id = input[slot]
    if (!byId.has(id)) return { error: `unknown_${slot}` }
    if (byId.get(id) !== SLOT_CATEGORY[slot]) return { error: `invalid_${slot}` }
  }
  return { parts: byId }
}
