// app/api/notifications/route.ts (Phase 3)
// Notification inbox API, scoped to the session user.
//
// Authorization rule (documented per Global Constraints): the session IS the ownership
// boundary. GET only ever lists the caller's own rows; PATCH accepts either
// `{ markAllRead: true }` (bulk) or `{ ids: [...] }` (specific rows). Any named id that
// does not belong to the session user yields 404 for the whole request and changes nothing —
// never the other user's data ([REVIEW-FIX: backend-security #21]).
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50
const MAX_IDS = 200

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { allowed } = await rateLimit(`notifications-get:${session.user.id}`, 120, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  const cursor = new URL(req.url).searchParams.get('cursor')
  const rows = await prisma.notification.findMany({
    where: { userId: session.user.id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, title: true, message: true, link: true, isRead: true, createdAt: true },
  })
  const hasMore = rows.length > PAGE_SIZE
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows
  return Response.json({
    notifications: page,
    nextCursor: hasMore ? page[page.length - 1].id : null,
  })
}

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id

  const { allowed } = await rateLimit(`notifications-patch:${userId}`, 30, 60)
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

  if (fields.markAllRead === true) {
    const result = await prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true } })
    return Response.json({ updated: result.count })
  }

  if (Array.isArray(fields.ids)) {
    const ids = fields.ids
    if (ids.length === 0 || ids.length > MAX_IDS || !ids.every((id) => typeof id === 'string')) {
      return Response.json({ error: 'invalid_ids' }, { status: 400 })
    }
    // Negative authz: if ANY named id belongs to someone else (or doesn't exist), the whole
    // request 404s and nothing is modified — no partial writes, no cross-user confirmation.
    const foreign = await prisma.notification.findFirst({
      where: { id: { in: ids }, userId: { not: userId } },
      select: { id: true },
    })
    if (foreign) return Response.json({ error: 'not_found' }, { status: 404 })
    const result = await prisma.notification.updateMany({ where: { id: { in: ids }, userId }, data: { isRead: true } })
    return Response.json({ updated: result.count })
  }

  return Response.json({ error: 'invalid_body' }, { status: 400 })
}
