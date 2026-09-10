// app/api/builds/[id]/ratings/route.ts
// Rating/comment CRUD for a build. AUTHZ RULES (standing Global-Constraints requirement):
//   POST   — any logged-in user; one rating per user per build, enforced by the
//            @@unique([buildId, userId]) constraint (upsert — a second POST edits, never duplicates)
//   GET    — public, cursor-paginated (list endpoint pagination rule)
//   PATCH  — owner-only (401 / 403 / 404 — negative test in tests/integration/build-ratings.test.ts)
//   DELETE — owner, or TRUSTED/ADMIN moderating any rating; moderation writes an append-only
//            AuditLog row (Phase 4 model)
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { RATING_COMMENT_MAX as COMMENT_MAX } from '@/lib/markdownFieldCaps'

const PAGE_SIZE = 20
type Ctx = { params: Promise<{ id: string }> }

function parseRatingBody(body: unknown): { stars?: number; comment?: string | null; errors?: string[] } {
  if (typeof body !== 'object' || body === null) return { errors: ['invalid_body'] }
  const b = body as Record<string, unknown>
  const errors: string[] = []
  let stars: number | undefined
  let comment: string | null | undefined
  if (typeof b.stars !== 'number' || !Number.isInteger(b.stars) || b.stars < 1 || b.stars > 5) {
    errors.push('invalid_stars')
  } else stars = b.stars
  if (b.comment !== undefined) {
    if (b.comment === null) comment = null
    else if (typeof b.comment === 'string') comment = b.comment.trim().slice(0, COMMENT_MAX) || null
    else errors.push('invalid_comment')
  }
  return errors.length > 0 ? { errors } : { stars, comment }
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id: buildId } = await params
  const build = await prisma.build.findUnique({ where: { id: buildId }, select: { id: true } })
  if (!build) return Response.json({ error: 'not_found' }, { status: 404 })

  const url = new URL(_req.url)
  const cursor = url.searchParams.get('cursor')

  const rows = await prisma.rating.findMany({
    where: { buildId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: { user: { select: { username: true } } },
  })
  const hasMore = rows.length > PAGE_SIZE
  const ratings = hasMore ? rows.slice(0, PAGE_SIZE) : rows
  return Response.json(
    {
      ratings: ratings.map((r) => ({
        id: r.id,
        stars: r.stars,
        comment: r.comment,
        createdAt: r.createdAt.toISOString(),
        username: r.user.username, // username is the platform identity — always visible, even for minors (lib/privacy.ts)
      })),
      nextCursor: hasMore ? ratings[ratings.length - 1].id : null,
    },
    { status: 200 },
  )
}

export async function POST(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { allowed } = await rateLimit(`ratings:create:${session.user.id}`, 30, 60 * 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  const { id: buildId } = await params
  const build = await prisma.build.findUnique({ where: { id: buildId }, select: { id: true } })
  if (!build) return Response.json({ error: 'not_found' }, { status: 404 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const { stars, comment, errors } = parseRatingBody(body)
  if (errors) return Response.json({ error: errors[0], errors }, { status: 400 })

  // Upsert via the @@unique([buildId, userId]) constraint — a second rating from the same
  // user EDITS their existing one instead of duplicating.
  const rating = await prisma.rating.upsert({
    where: { buildId_userId: { buildId, userId: session.user.id } },
    create: { buildId, userId: session.user.id, stars: stars!, comment: comment ?? null },
    update: { stars: stars!, comment: comment ?? null },
  })
  return Response.json({ id: rating.id }, { status: 201 })
}

export async function PATCH(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id: buildId } = await params

  const url = new URL(req.url)
  const ratingId = url.searchParams.get('ratingId')
  if (!ratingId) return Response.json({ error: 'invalid_ratingId' }, { status: 400 })

  const rating = await prisma.rating.findUnique({ where: { id: ratingId }, select: { id: true, userId: true, buildId: true } })
  // 404 (not 403) when the rating doesn't exist OR belongs to another build — existence isn't leaked.
  if (!rating || rating.buildId !== buildId) return Response.json({ error: 'not_found' }, { status: 404 })
  if (rating.userId !== session.user.id) return Response.json({ error: 'forbidden' }, { status: 403 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const { stars, comment, errors } = parseRatingBody(body)
  if (errors) return Response.json({ error: errors[0], errors }, { status: 400 })
  if (stars === undefined && comment === undefined) return Response.json({ error: 'empty_patch' }, { status: 400 })

  await prisma.rating.update({
    where: { id: rating.id },
    data: { ...(stars !== undefined ? { stars } : {}), ...(comment !== undefined ? { comment } : {}) },
  })
  return Response.json({ id: rating.id }, { status: 200 })
}

export async function DELETE(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id: buildId } = await params

  const url = new URL(req.url)
  const ratingId = url.searchParams.get('ratingId')
  if (!ratingId) return Response.json({ error: 'invalid_ratingId' }, { status: 400 })

  const rating = await prisma.rating.findUnique({
    where: { id: ratingId },
    select: { id: true, userId: true, buildId: true, comment: true },
  })
  if (!rating || rating.buildId !== buildId) return Response.json({ error: 'not_found' }, { status: 404 })

  const isOwner = rating.userId === session.user.id
  let moderating = false
  if (!isOwner) {
    const caller = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
    moderating = caller?.role === 'TRUSTED' || caller?.role === 'ADMIN'
    if (!moderating) return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  const actorId = session.user.id
  await prisma.$transaction(async (tx) => {
    await tx.rating.delete({ where: { id: rating.id } })
    if (moderating) {
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'rating.moderate_remove',
          targetType: 'rating',
          targetId: rating.id,
          summary: `Bewertung an Build ${buildId} entfernt (Moderation${rating.comment ? ', Kommentar vorhanden' : ''})`,
        },
      })
    }
  })
  return Response.json({ ok: true }, { status: 200 })
}
