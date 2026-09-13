// app/api/ratings/route.ts (MVP4, #139/#141/#143)
// Polymorphe Rating-API — DIE Implementierung für Bewertungen auf Beyblade, Build und Teil.
// targetType (BEYBLADE|BUILD|PART) + targetId kommen als Query-Params; Integrität via
// lib/ratingTarget.ts (Rating.targetId trägt bewusst KEINE FK — ein Rating darf das Löschen
// seines Ziels nicht blockieren; schreibend/lesend wird die Existenz verifiziert, sonst 404
// statt stiller Leiche). Der Legacy-Pfad /api/builds/[id]/ratings delegiert hierher mit
// targetType=BUILD, damit bestehende Clients und die Integration-Suite unverändert laufen.
// AUTHZ RULES (standing Global-Constraints requirement):
//   POST     — any logged-in user; one rating per user per target, enforced by the
//              @@unique([targetType, targetId, userId]) constraint (upsert — a second POST
//              edits, never duplicates)
//   GET      — public, cursor-paginated (list endpoint pagination rule)
//   PATCH/PUT— owner-only (401 / 403 / 404 — negative test in tests/integration/build-ratings.test.ts)
//   DELETE   — owner, or TRUSTED/ADMIN moderating any rating; moderation writes an append-only
//              AuditLog row (Phase 4 model)
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { ratingTargetExists } from '@/lib/ratingTarget'
import { parseRatingBody } from '@/lib/ratingInput'
import type { RatingTargetType } from '@prisma/client'

const PAGE_SIZE = 20
const TARGET_TYPES: readonly RatingTargetType[] = ['BEYBLADE', 'BUILD', 'PART']
const TARGET_LABEL: Record<RatingTargetType, string> = { BEYBLADE: 'Beyblade', BUILD: 'Build', PART: 'Teil' }

type ParsedTarget = { targetType: RatingTargetType; targetId: string }

function parseTarget(url: URL): ParsedTarget | { error: string } {
  const targetType = url.searchParams.get('targetType')
  const targetId = url.searchParams.get('targetId')
  if (!targetType || !(TARGET_TYPES as readonly string[]).includes(targetType)) return { error: 'invalid_targetType' }
  if (!targetId) return { error: 'invalid_targetId' }
  return { targetType: targetType as RatingTargetType, targetId }
}

export async function GET(req: Request) {
  const target = parseTarget(new URL(req.url))
  if ('error' in target) return Response.json({ error: target.error }, { status: 400 })
  if (!(await ratingTargetExists(prisma, target.targetType, target.targetId))) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const cursor = new URL(req.url).searchParams.get('cursor')
  const rows = await prisma.rating.findMany({
    where: { targetType: target.targetType, targetId: target.targetId },
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
      nextCursor: hasMore ? ratings[ratings.length - 1]!.id : null,
    },
    { status: 200 },
  )
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { allowed } = await rateLimit(`ratings:create:${session.user.id}`, 30, 60 * 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  const target = parseTarget(new URL(req.url))
  if ('error' in target) return Response.json({ error: target.error }, { status: 400 })
  if (!(await ratingTargetExists(prisma, target.targetType, target.targetId))) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const { stars, comment, errors } = parseRatingBody(body)
  if (errors) return Response.json({ error: errors[0], errors }, { status: 400 })

  // Upsert via the @@unique([targetType, targetId, userId]) constraint — a second rating from
  // the same user EDITS their existing one instead of duplicating.
  const rating = await prisma.rating.upsert({
    where: { targetType_targetId_userId: { targetType: target.targetType, targetId: target.targetId, userId: session.user.id } },
    create: { targetType: target.targetType, targetId: target.targetId, userId: session.user.id, stars: stars!, comment: comment ?? null },
    update: { stars: stars!, comment: comment ?? null },
  })
  return Response.json({ id: rating.id }, { status: 201 })
}

async function mutate(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const target = parseTarget(url)
  if ('error' in target) return Response.json({ error: target.error }, { status: 400 })
  const ratingId = url.searchParams.get('ratingId')
  if (!ratingId) return Response.json({ error: 'invalid_ratingId' }, { status: 400 })

  const rating = await prisma.rating.findUnique({ where: { id: ratingId }, select: { id: true, userId: true, targetType: true, targetId: true } })
  // 404 (not 403) when the rating doesn't exist OR belongs to another target — existence isn't leaked.
  if (!rating || rating.targetType !== target.targetType || rating.targetId !== target.targetId) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }
  return { userId: session.user.id, target, rating }
}

export async function PATCH(req: Request) {
  const gate = await mutate(req)
  if (gate instanceof Response) return gate
  const { userId, rating } = gate
  if (rating.userId !== userId) return Response.json({ error: 'forbidden' }, { status: 403 })

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

// PUT = PATCH (volle Feld-Menge, wie das Formular sie schickt — dieselbe Semantik).
export const PUT = PATCH

export async function DELETE(req: Request) {
  const gate = await mutate(req)
  if (gate instanceof Response) return gate
  const { userId, target, rating } = gate

  const isOwner = rating.userId === userId
  let moderating = false
  if (!isOwner) {
    const caller = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
    moderating = caller?.role === 'TRUSTED' || caller?.role === 'ADMIN'
    if (!moderating) return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  const actorId = userId
  await prisma.$transaction(async (tx) => {
    await tx.rating.delete({ where: { id: rating.id } })
    if (moderating) {
      await tx.auditLog.create({
        data: {
          actorId,
          action: 'rating.moderate_remove',
          targetType: 'rating',
          targetId: rating.id,
          summary: `Bewertung an ${TARGET_LABEL[target.targetType]} ${target.targetId} entfernt (Moderation)`,
        },
      })
    }
  })
  return Response.json({ ok: true }, { status: 200 })
}
