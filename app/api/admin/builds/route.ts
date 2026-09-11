// app/api/admin/builds/route.ts
// Curator direct-create of an official Set (Phase 11's third creation path, wired for Phase 20
// naming/dedup). AUTHZ RULE (standing Global-Constraints requirement): TRUSTED/JUDGE/
// ORGANIZER/ADMIN only (same widened reviewer tier as CatalogProposal review — 401 anonymous,
// 403 plain USER). POST creates the Build with isOfficialSet=true; the curator-entered retail
// box name is used verbatim when provided and NEVER overridden by the canonical name — the
// canonical "<Blade> <Ratchet><Bit-short>" name is derived only when no name was given.
// Duplicate combo (same bladeId+ratchetId+bitId) returns the existing Build's id gracefully
// ({ id, existing: true }) instead of a raw unique-constraint 500. Every successful create
// writes an append-only AuditLog row; rate-limited per curator.
// PATCH — narrow follow-up edit of a single existing official Set's `productCode` (the
// manufacturer retail SKU, e.g. Hasbro "F9580"). Deliberately minimal: a full Build-edit
// surface (name/type/image, reachable from the detail page) is tracked separately (issue #108)
// — this only unblocks setting/correcting the product code without going back through create.
import { requireCurator } from '@/lib/guards'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { parseBody, type BodySchema } from '@/lib/parseBody'
import { parseBuildInput, verifyBuildParts } from '@/lib/buildInput'
import { deriveBuildName } from '@/lib/buildNaming'

const PATCH_SCHEMA: BodySchema = {
  id: { type: 'string', minLength: 1, required: true, token: 'invalid_id' },
  productCode: { type: 'string', trim: true, maxLength: 32, nullable: true, required: true, token: 'invalid_productCode' },
}

export async function POST(req: Request): Promise<Response> {
  const gate = await requireCurator()
  if ('error' in gate) return gate.error
  const { allowed } = await rateLimit(`builds:admin-create:${gate.userId}`, 60, 60 * 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const { data, errors } = parseBuildInput(body, { official: true })
  if (errors) return Response.json({ error: errors[0], errors }, { status: 400 })

  const verified = await verifyBuildParts(prisma, data!)
  if ('error' in verified) return Response.json({ error: verified.error }, { status: 400 })

  // Phase 20 duplicate-combo pre-check — even for official Sets the same three parts must not
  // back two Build rows; point the curator at the existing build instead.
  const combo = { bladeId: data!.bladeId, ratchetId: data!.ratchetId, bitId: data!.bitId }
  const existing = await prisma.build.findUnique({ where: { bladeId_ratchetId_bitId: combo }, select: { id: true } })
  if (existing) return Response.json({ id: existing.id, existing: true }, { status: 200 })

  // Retail box name wins when the curator entered one; only a nameless create gets the
  // canonical "<Blade> <Ratchet><Bit-short>" derivation.
  const name =
    data!.name ??
    deriveBuildName(
      verified.parts.get(data!.bladeId)!.name,
      verified.parts.get(data!.ratchetId)!.name,
      verified.parts.get(data!.bitId)!.name,
    )
  const build = await prisma.$transaction(async (tx) => {
    const created = await tx.build.create({
      data: { ...combo, name, type: data!.type ?? undefined, isOfficialSet: true, productCode: data!.productCode },
    })
    await tx.auditLog.create({
      data: {
        actorId: gate.userId,
        action: 'build.create',
        targetType: 'build',
        targetId: created.id,
        summary: `Set „${created.name}“ angelegt`,
      },
    })
    return created
  })
  return Response.json({ id: build.id, existing: false }, { status: 201 })
}

export async function PATCH(req: Request): Promise<Response> {
  const gate = await requireCurator()
  if ('error' in gate) return gate.error
  const { allowed } = await rateLimit(`builds:admin-update:${gate.userId}`, 60, 60 * 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const { data, errors } = parseBody(body, PATCH_SCHEMA, { partial: false })
  if (errors.length > 0) return Response.json({ error: errors[0], errors }, { status: 400 })
  const { id, productCode } = data as { id: string; productCode: string | null }

  const existing = await prisma.build.findUnique({ where: { id }, select: { id: true, name: true, isOfficialSet: true } })
  if (!existing) return Response.json({ error: 'not_found' }, { status: 404 })
  if (!existing.isOfficialSet) return Response.json({ error: 'not_official_set' }, { status: 400 })

  if (productCode) {
    const conflict = await prisma.build.findUnique({ where: { productCode }, select: { id: true } })
    if (conflict && conflict.id !== id) return Response.json({ error: 'product_code_taken' }, { status: 409 })
  }

  const build = await prisma.$transaction(async (tx) => {
    const updated = await tx.build.update({ where: { id }, data: { productCode } })
    await tx.auditLog.create({
      data: {
        actorId: gate.userId,
        action: 'build.update',
        targetType: 'build',
        targetId: updated.id,
        summary: `Set „${existing.name}“ — Product Code auf „${productCode ?? '—'}“ gesetzt`,
      },
    })
    return updated
  })
  return Response.json({ id: build.id, productCode: build.productCode }, { status: 200 })
}
