// app/api/admin/builds/route.ts (Phase 11's third creation path; MVP4 #141 — Build-Split)
// Curator direct-create of an official Set — erzeugt seit dem Split eine BEYBLADE-Zeile (der
// Route-Pfad /api/admin/builds bleibt bis zur IA-Umstellung in MVP4/4 bestehen; das Aggregat
// heißt kanonisch Beyblade, siehe Terminologie-Regel in AGENTS.md). AUTHZ RULE (standing
// Global-Constraints requirement): TRUSTED/JUDGE/ORGANIZER/ADMIN only (same widened reviewer
// tier as CatalogProposal review — 401 anonymous, 403 plain USER). Der Set-Name ist required
// (Retail-Produkt), fehlt er, greift die kanonische Bauform-abhängige Ableitung (RC16 #122) —
// ein vom Kurator eingegebener Name gewinnt niemals. Duplicate combo (exakte 7-Slot-
// Teilekombination, NULL-sicher) returns the existing Beyblade's id gracefully ({ id,
// existing: true }) instead of a raw unique-constraint 500. Every successful create writes an
// append-only AuditLog row; rate-limited per curator.
// PATCH — narrow follow-up edit of a single existing Beyblade's `productCode` (the
// manufacturer retail SKU, e.g. Hasbro "F9580"). Deliberately minimal: a full Beyblade-edit
// surface (name/image, reachable from the detail page) lands with the Beyblade-Detailseite
// (MVP4/4, issue #144) — this only unblocks setting/correcting the product code without
// going back through create.
import { requireCurator } from '@/lib/guards'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { parseBody, type BodySchema } from '@/lib/parseBody'
import { parseBeybladeInput } from '@/lib/beybladeInput'
import { comboWhere, verifyAssemblyParts } from '@/lib/assembly'
import { deriveBuildNameFromParts } from '@/lib/buildNaming'

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
  const { data, errors } = parseBeybladeInput(body)
  if (errors) return Response.json({ error: errors[0], errors }, { status: 400 })

  const verified = await verifyAssemblyParts(prisma, data!)
  if ('error' in verified) return Response.json({ error: verified.error }, { status: 400 })

  // Duplicate-combo pre-check (RC16 #122: exakte 7-Slot-Teilekombination, NULL-sicher) —
  // dieselben Teile dürfen nicht zwei Beyblade-Zeilen tragen; point the curator at the
  // existing Beyblade instead. (Dieselbe Kombination als USER-BUILD zu haben, ist erlaubt.)
  const combo = comboWhere(data!)
  const existing = await prisma.beyblade.findFirst({ where: combo, select: { id: true } })
  if (existing) return Response.json({ id: existing.id, existing: true }, { status: 200 })

  // Der Set-Name ist required; ein nameless Payload wird vom Parser abgelehnt — diese
  // Fallback-Ableitung deckt den Fall ab, dass künftig ein Create ohne expliziten Namen
  // erlaubt wird (Kanone bleibt Bauform-abhängig, RC16 #122).
  const name = data!.name || deriveBuildNameFromParts(verified.parts, data!)
  const beyblade = await prisma.$transaction(async (tx) => {
    const created = await tx.beyblade.create({
      data: {
        ...combo,
        name,
        manufacturer: data!.manufacturer,
        productCode: data!.productCode,
      },
    })
    await tx.auditLog.create({
      data: {
        actorId: gate.userId,
        action: 'beyblade.create',
        targetType: 'beyblade',
        targetId: created.id,
        summary: `Set „${created.name}“ angelegt`,
      },
    })
    return created
  })
  return Response.json({ id: beyblade.id, existing: false }, { status: 201 })
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

  const existing = await prisma.beyblade.findUnique({ where: { id }, select: { id: true, name: true } })
  if (!existing) return Response.json({ error: 'not_found' }, { status: 404 })

  if (productCode) {
    const conflict = await prisma.beyblade.findUnique({ where: { productCode }, select: { id: true } })
    if (conflict && conflict.id !== id) return Response.json({ error: 'product_code_taken' }, { status: 409 })
  }

  const beyblade = await prisma.$transaction(async (tx) => {
    const updated = await tx.beyblade.update({ where: { id }, data: { productCode } })
    await tx.auditLog.create({
      data: {
        actorId: gate.userId,
        action: 'beyblade.update',
        targetType: 'beyblade',
        targetId: updated.id,
        summary: `Set „${existing.name}“ — Product Code auf „${productCode ?? '—'}“ gesetzt`,
      },
    })
    return updated
  })
  return Response.json({ id: beyblade.id, productCode: beyblade.productCode }, { status: 200 })
}
