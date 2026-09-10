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
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { isCurator } from '@/lib/roles'
import { parseBuildInput, verifyBuildParts } from '@/lib/buildInput'
import { deriveBuildName } from '@/lib/buildNaming'

type CuratorGate = { error: Response } | { actorId: string }

async function requireCurator(): Promise<CuratorGate> {
  const session = await auth()
  if (!session?.user?.id) return { error: Response.json({ error: 'unauthorized' }, { status: 401 }) }
  const caller = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
  if (!isCurator(caller?.role)) {
    return { error: Response.json({ error: 'forbidden' }, { status: 403 }) }
  }
  return { actorId: session.user.id }
}

export async function POST(req: Request): Promise<Response> {
  const gate = await requireCurator()
  if ('error' in gate) return gate.error
  const { allowed } = await rateLimit(`builds:admin-create:${gate.actorId}`, 60, 60 * 60)
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
      data: { ...combo, name, type: data!.type ?? undefined, isOfficialSet: true },
    })
    await tx.auditLog.create({
      data: {
        actorId: gate.actorId,
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
