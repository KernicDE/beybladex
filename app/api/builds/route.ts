// app/api/builds/route.ts
// GET — public build search as JSON (the deck builder's part-picker consumes this; the /builds
// page itself is server-rendered). Cursor-paginated per the list-endpoint rule. Each result
// carries its Auto-Meta win-rate stats (Phase 5 Part D) from the Redis cache — one batch read
// for the whole page, with direct-compute fallback when the cache is empty.
// Phase 11 (item 6): ?onlyMine=1 requires a session (self-only — no other user's collection is
// exposed by this filter) and restricts results to builds the caller owns all parts of
// (RC16 #122: 2–6 je nach Bauform).
// POST — any logged-in user registers a one-off personal combo (the deck builder's
// BuildComboForm posts here). AUTHZ RULE (standing Global-Constraints requirement): a session
// is required (401 anonymous — negative test in tests/integration/duplicate-build-combo.test.ts);
// the server derives the canonical name from the parts when the creator gave none (Phase 20).
// Duplicate combo (same parts across all 7 slots, RC16 #122) returns the EXISTING build
// ({ id, existing: true, build }) instead of a raw unique-constraint 500.
// MVP4 (#141): offizielle Sets leben im Beyblade-Modell — dieser Pfad erzeugt ausschließlich
// persönliche Builds (visibility UNLISTED default); Set-Anlage läuft über die Curator-Pfade
// (POST /api/admin/builds bzw. CatalogProposal-Approval), die Beyblade-Zeilen erzeugen.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { searchBuilds } from '@/lib/buildSearch'
import { getBuildStats } from '@/lib/metaCache'
import { rateLimit } from '@/lib/rateLimit'
import { parseBuildInput } from '@/lib/buildInput'
import { comboWhere, verifyAssemblyParts } from '@/lib/assembly'
import { deriveBuildNameFromParts } from '@/lib/buildNaming'

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
        visibility: b.visibility,
        blade: b.blade,
        lockChip: b.lockChip,
        overBlade: b.overBlade,
        metalBlade: b.metalBlade,
        assistBlade: b.assistBlade,
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
  lockChip: { select: { id: true, name: true } },
  overBlade: { select: { id: true, name: true } },
  metalBlade: { select: { id: true, name: true } },
  assistBlade: { select: { id: true, name: true } },
  ratchet: { select: { id: true, name: true } },
  bit: { select: { id: true, name: true } },
} as const

// RC16 (#122) — kanonischer Name je nach Bauform, aufgelöst über die verifizierten Teile.
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

  const verified = await verifyAssemblyParts(prisma, data!)
  if ('error' in verified) return Response.json({ error: verified.error }, { status: 400 })

  // Phase 20 duplicate-combo pre-check (RC16 #122: exakte 7-Slot-Kombination, NULL-sicher):
  // the same parts must never produce a second Build row — return the existing build
  // gracefully (the unique expression index is the last-resort backstop, not the user path).
  const combo = comboWhere(data!)
  const existing = await prisma.build.findFirst({
    where: combo,
    include: BUILD_INCLUDE,
  })
  if (existing) return Response.json({ id: existing.id, existing: true, build: existing }, { status: 200 })

  // No explicit name on the personal-combo path (parseBuildInput forces name=null for
  // non-official creates) — derive the canonical name for the build's Bauform.
  const name = deriveBuildNameFromParts(verified.parts, data!)
  const build = await prisma.build.create({
    // #144 — der Ersteller wird am Build vermerkt (Öffentliche-Builds-Karten zeigen ihn);
    // beim Duplicate-Combo-Return oben bleibt der bestehende Datensatz unverändert.
    data: { ...combo, name, type: data!.type ?? undefined, creatorId: session.user.id },
    include: BUILD_INCLUDE,
  })
  return Response.json({ id: build.id, existing: false, build }, { status: 201 })
}
