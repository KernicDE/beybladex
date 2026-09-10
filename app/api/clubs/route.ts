// app/api/clubs/route.ts
// GET — public club list (?q= filters name/description, paginated take/cursor).
// POST — create a Club. AUTHZ RULE (standing Global-Constraints requirement): a session is
// required (401 otherwise); the creator becomes the club's owner AND an isAdmin=true
// ClubMember row in ONE transaction — owner-without-membership is an invalid state the
// schema can't express, so it must never exist. ownerId is ALWAYS taken from the session.
// Slug generation reuses lib/slug.ts (Phase 2). Club.name is @unique — a taken name is 409.
// Rate-limited per user.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { slugify, uniqueSlug } from '@/lib/slug'
import { CLUB_DESCRIPTION_MAX as DESCRIPTION_MAX } from '@/lib/markdownFieldCaps'
import { parseOptionalUrl } from '@/lib/urlValidation'

const PAGE_SIZE = 24
const NAME_MAX = 100
const URL_MAX = 200
const JOIN_POLICIES = ['OPEN', 'APPLICATION', 'INVITE_ONLY'] as const

export async function GET(req: Request) {
  const url = new URL(req.url)
  const q = (url.searchParams.get('q') ?? '').trim()
  const takeParam = Number(url.searchParams.get('take') ?? PAGE_SIZE)
  const cursor = url.searchParams.get('cursor')

  const take = Number.isInteger(takeParam) && takeParam > 0 && takeParam <= 100 ? takeParam : PAGE_SIZE

  const rows = await prisma.club.findMany({
    where: q
      ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] }
      : {},
    orderBy: { name: 'asc' },
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      createdAt: true,
      _count: { select: { members: { where: { status: 'ACTIVE' } }, tournaments: true } }, // Phase 13: pending rows never inflate the count
    },
  })

  const hasMore = rows.length > take
  const page = hasMore ? rows.slice(0, take) : rows
  const nextCursor = hasMore ? page[page.length - 1].id : null

  return Response.json({ clubs: page, nextCursor })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id

  const { allowed } = await rateLimit(`clubs:create:${userId}`, 10, 60 * 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null) {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }
  const fields = body as Record<string, unknown>

  const name = fields.name
  if (typeof name !== 'string' || name.trim().length === 0 || name.length > NAME_MAX) {
    return Response.json({ error: 'invalid_club_name' }, { status: 400 })
  }
  const description = fields.description
  if (description !== undefined && description !== null && (typeof description !== 'string' || description.length > DESCRIPTION_MAX)) {
    return Response.json({ error: 'invalid_description' }, { status: 400 })
  }
  const websiteUrl = parseOptionalUrl(fields.websiteUrl, URL_MAX)
  if (!websiteUrl.ok) return Response.json({ error: 'invalid_club_url' }, { status: 400 })
  const discordUrl = parseOptionalUrl(fields.discordUrl, URL_MAX)
  if (!discordUrl.ok) return Response.json({ error: 'invalid_club_url' }, { status: 400 })
  const joinPolicy = fields.joinPolicy ?? 'OPEN'
  if (typeof joinPolicy !== 'string' || !(JOIN_POLICIES as readonly string[]).includes(joinPolicy)) {
    return Response.json({ error: 'invalid_join_policy' }, { status: 400 })
  }

  // name is @unique — resolve before the transaction so a taken name is a clean 409,
  // not a mid-transaction unique-constraint abort.
  if (await prisma.club.findUnique({ where: { name: name.trim() } })) {
    return Response.json({ error: 'club_name_taken' }, { status: 409 })
  }

  const base = slugify(name.trim())
  const slug = await uniqueSlug(base, async (s) => (await prisma.club.findUnique({ where: { slug: s } })) !== null)

  const club = await prisma.$transaction(async (tx) => {
    const created = await tx.club.create({
      data: {
        name: name.trim(), slug,
        description: typeof description === 'string' ? description.trim() || null : null,
        websiteUrl: websiteUrl.value,
        discordUrl: discordUrl.value,
        joinPolicy: joinPolicy as (typeof JOIN_POLICIES)[number],
        ownerId: userId,
      },
    })
    await tx.clubMember.create({
      data: { clubId: created.id, userId, isAdmin: true },
    })
    return created
  })

  return Response.json({ id: club.id, slug: club.slug, name: club.name }, { status: 201 })
}
