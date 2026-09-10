// app/api/builds/route.ts
// GET — public build search as JSON (the deck builder's part-picker consumes this; the /builds
// page itself is server-rendered). Cursor-paginated per the list-endpoint rule. Each result
// carries its Auto-Meta win-rate stats (Phase 5 Part D) from the Redis cache — one batch read
// for the whole page, with direct-compute fallback when the cache is empty.
// Phase 11 (item 6): ?onlyMine=1 requires a session (self-only — no other user's collection is
// exposed by this filter) and restricts results to builds the caller owns all three parts of.
// POST — any logged-in user registers a one-off personal combo (the deck builder's
// BuildComboForm posts here). AUTHZ RULE (standing Global-Constraints requirement): a session
// is required (401 anonymous — negative test in tests/integration/duplicate-build-combo.test.ts);
// the server forces isOfficialSet=false and derives the canonical name from the parts when the
// creator gave none (Phase 20). Duplicate combo (same bladeId+ratchetId+bitId) returns the
// EXISTING build ({ id, existing: true, build }) instead of a raw unique-constraint 500.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { searchBuilds } from '@/lib/buildSearch'
import { getBuildStats } from '@/lib/metaCache'
import { rateLimit } from '@/lib/rateLimit'
import { parseBuildInput, verifyBuildParts } from '@/lib/buildInput'
import { deriveBuildName } from '@/lib/buildNaming'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const q = url.searchParams.get('q') ?? ''
  const cursor = url.searchParams.get('cursor')
  const onlyMine = url.searchParams.get('onlyMine') === '1'

  let onlyMineUserId: string | null = null
  if (onlyMine) {
    const session = await auth()
    if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
    onlyMineUserId = session.user.id
  }

  const { builds, nextCursor } = await searchBuilds({ q, cursor, onlyMineUserId })
  const winRates = await getBuildStats(builds.map((b) => b.id))
  return Response.json(
    {
      builds: builds.map((b) => ({
        id: b.id,
        type: b.type,
        name: b.name,
        isOfficialSet: b.isOfficialSet,
        blade: b.blade,
        ratchet: b.ratchet,
        bit: b.bit,
        winRate: winRates.get(b.id) ?? null,
        ...('available' in b ? { available: b.available } : {}),
      })),
      nextCursor,
    },
    { status: 200 },
  )
}

const BUILD_INCLUDE = {
  blade: { select: { id: true, name: true, imageId: true } },
  ratchet: { select: { id: true, name: true } },
  bit: { select: { id: true, name: true } },
} as const

export async function POST(req: Request): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { allowed } = await rateLimit(`builds:create:${session.user.id}`, 30, 60 * 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const { data, errors } = parseBuildInput(body, { official: false })
  if (errors) return Response.json({ error: errors[0], errors }, { status: 400 })

  const verified = await verifyBuildParts(prisma, data!)
  if ('error' in verified) return Response.json({ error: verified.error }, { status: 400 })

  // Phase 20 duplicate-combo pre-check: the same three parts must never produce a second
  // Build row — return the existing build gracefully (the unique index is the last-resort
  // backstop, not the user-facing path).
  const combo = { bladeId: data!.bladeId, ratchetId: data!.ratchetId, bitId: data!.bitId }
  const existing = await prisma.build.findUnique({
    where: { bladeId_ratchetId_bitId: combo },
    include: BUILD_INCLUDE,
  })
  if (existing) return Response.json({ id: existing.id, existing: true, build: existing }, { status: 200 })

  // No explicit name on the personal-combo path (parseBuildInput forces name=null for
  // non-official creates) — derive the canonical "<Blade> <Ratchet><Bit-short>" name.
  const name = deriveBuildName(
    verified.parts.get(data!.bladeId)!.name,
    verified.parts.get(data!.ratchetId)!.name,
    verified.parts.get(data!.bitId)!.name,
  )
  const build = await prisma.build.create({
    data: { ...combo, name, type: data!.type ?? undefined },
    include: BUILD_INCLUDE,
  })
  return Response.json({ id: build.id, existing: false, build }, { status: 201 })
}
