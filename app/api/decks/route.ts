// app/api/decks/route.ts
// Deck CRUD (Phase 5 Part A). AUTHZ RULE (standing Global-Constraints requirement): every
// method requires a session (401) and acts ONLY on the caller's own decks — a body can never
// nominate another owner (negative tests in tests/integration/deck-api.test.ts).
//   GET  — the caller's decks, cursor-paginated (list-endpoint pagination rule)
//   POST — create a deck (title + optional initial builds), with the no-duplicate-parts deck
//          rule enforced SERVER-SIDE via lib/deckValidation (the client check is UX, not security)
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { validateNoDuplicateParts } from '@/lib/deckValidation'

const TITLE_MAX = 80
const MAX_BUILDS = 3 // WBO counterdeck / 3on3 — a deck holds at most three builds
const PAGE_SIZE = 20

interface DeckBody {
  title?: unknown
  buildIds?: unknown
}

function parseDeckBody(body: unknown): { title?: string; buildIds?: string[]; error?: string } {
  if (typeof body !== 'object' || body === null) return { error: 'invalid_body' }
  const b = body as DeckBody
  const out: { title?: string; buildIds?: string[] } = {}
  if (b.title !== undefined) {
    if (typeof b.title !== 'string' || b.title.trim().length === 0) return { error: 'invalid_title' }
    out.title = b.title.trim().slice(0, TITLE_MAX)
  }
  if (b.buildIds !== undefined) {
    if (!Array.isArray(b.buildIds) || b.buildIds.some((id) => typeof id !== 'string') || b.buildIds.length > MAX_BUILDS) {
      return { error: 'invalid_buildIds' }
    }
    out.buildIds = [...new Set(b.buildIds as string[])]
  }
  return out
}

/** Loads builds and enforces the deck rule server-side. Shared by POST and PATCH. */
async function validateDeckBuilds(buildIds: string[]) {
  const builds = await prisma.build.findMany({
    where: { id: { in: buildIds } },
    include: { blade: { select: { name: true } }, ratchet: { select: { name: true } }, bit: { select: { name: true } } },
  })
  if (builds.length !== buildIds.length) return { error: 'unknown_build' as const }
  const { valid, conflicts } = validateNoDuplicateParts(builds)
  if (!valid) return { error: 'duplicate_parts' as const, conflicts }
  return { builds }
}

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const cursor = new URL(req.url).searchParams.get('cursor')

  const rows = await prisma.deck.findMany({
    where: { userId: session.user.id },
    orderBy: { id: 'asc' },
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { builds: { include: { build: { select: { id: true, type: true, blade: { select: { name: true } }, ratchet: { select: { name: true } }, bit: { select: { name: true } } } } } } },
  })
  const hasMore = rows.length > PAGE_SIZE
  const decks = hasMore ? rows.slice(0, PAGE_SIZE) : rows
  return Response.json(
    {
      decks: decks.map((d) => ({
        id: d.id,
        title: d.title,
        builds: d.builds.map((db) => db.build),
      })),
      nextCursor: hasMore ? decks[decks.length - 1].id : null,
    },
    { status: 200 },
  )
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { allowed } = await rateLimit(`decks:create:${session.user.id}`, 20, 60 * 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = parseDeckBody(body)
  if (parsed.error) return Response.json({ error: parsed.error }, { status: 400 })
  if (!parsed.title) return Response.json({ error: 'invalid_title' }, { status: 400 })

  const buildIds = parsed.buildIds ?? []
  if (buildIds.length > 0) {
    const check = await validateDeckBuilds(buildIds)
    if ('error' in check) {
      return Response.json({ error: check.error, ...(check.conflicts ? { conflicts: check.conflicts } : {}) }, { status: 400 })
    }
  }

  const deck = await prisma.deck.create({
    data: {
      title: parsed.title,
      userId: session.user.id,
      builds: { create: buildIds.map((buildId, i) => ({ buildId, position: i + 1 })) },
    },
  })
  return Response.json({ id: deck.id }, { status: 201 })
}
