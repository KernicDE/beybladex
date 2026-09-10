// app/api/clubs/[slug]/messages/route.ts (Phase 12)
// Club chat: post, list, delete messages. AUTHZ RULES (standing Global-Constraints requirement):
// - GET  — only current ClubMembers (any role); 401 without a session, 404 for an unknown slug
//   (existence-leak policy, matching every other club route), 403 for a non-member.
// - POST — same authz as GET, plus a per-user-per-club rate limit (10/minute — a 50-message
//   buffer is useless if one user can flood it). The 50-message cap is enforced SYNCHRONOUSLY
//   in the SAME transaction as the insert (Phase 12 binding decision): insert, then delete
//   everything beyond the 50 most recent — no cron/scheduler needed for correctness.
// - DELETE (?messageId=) — the author may delete their own message; a club owner or isAdmin
//   member may delete ANY message (moderation, reusing the Phase 5 Part A Rating pattern).
//   A moderation delete writes an append-only AuditLog row (Phase 4 model); a self-delete does
//   not. Deleting a nonexistent/other-club messageId is 404 (existence isn't leaked).
// Real-time delivery: after a successful POST the row is published on the club's Redis pub/sub
// channel (lib/clubChat.ts) — the SSE stream subscribes on redisSubscriber.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { CLUB_MESSAGE_CAP, publishClubMessage, type ClubChatMessagePayload } from '@/lib/clubChat'

const BODY_MAX = 500 // bio-convention free-text cap (Phase 1 Task 12/13)
const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW_S = 60

type Ctx = { params: Promise<{ slug: string }> }

async function loadClubMembership(slug: string, userId: string) {
  const club = await prisma.club.findUnique({ where: { slug }, select: { id: true, ownerId: true } })
  if (!club) return null
  const caller = await prisma.clubMember.findUnique({
    where: { clubId_userId: { clubId: club.id, userId } },
    select: { isAdmin: true },
  })
  return { club, caller }
}

function toPayload(row: { id: string; clubId: string; authorId: string; body: string; createdAt: Date }, authorName: string): ClubChatMessagePayload {
  return { id: row.id, clubId: row.clubId, authorId: row.authorId, authorName, body: row.body, createdAt: row.createdAt.toISOString() }
}

export async function GET(_req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { slug } = await params
  const loaded = await loadClubMembership(slug, session.user.id)
  if (!loaded) return Response.json({ error: 'not_found' }, { status: 404 })
  if (!loaded.caller) return Response.json({ error: 'forbidden' }, { status: 403 })

  // Bounded by the cap itself: at most CLUB_MESSAGE_CAP rows can exist per club.
  const rows = await prisma.clubMessage.findMany({
    where: { clubId: loaded.club.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: CLUB_MESSAGE_CAP,
  })
  // authorId is a plain string column (NOT a User FK — Phase 12 erasure design), so usernames
  // are resolved in a second query; erased authors keep their anonymized username.
  const authors = await prisma.user.findMany({
    where: { id: { in: rows.map((r) => r.authorId) } },
    select: { id: true, username: true },
  })
  const authorNames = new Map(authors.map((a) => [a.id, a.username]))
  return Response.json({
    messages: rows.map((r) => toPayload(r, authorNames.get(r.authorId) ?? r.authorId)),
  }, { status: 200 })
}

export async function POST(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id

  const { slug } = await params
  const loaded = await loadClubMembership(slug, userId)
  if (!loaded) return Response.json({ error: 'not_found' }, { status: 404 })
  if (!loaded.caller) return Response.json({ error: 'forbidden' }, { status: 403 })

  const { allowed } = await rateLimit(`club-chat:post:${loaded.club.id}:${userId}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_S)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null || typeof (body as Record<string, unknown>).body !== 'string') {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }
  const text = ((body as Record<string, unknown>).body as string).trim()
  if (text.length === 0 || text.length > BODY_MAX) {
    return Response.json({ error: 'invalid_body' }, { status: 400 })
  }

  // Insert + cap enforcement in ONE transaction (Phase 12 binding decision): after the
  // insert, delete every message beyond the 50 most recent. id is the tiebreaker so
  // same-millisecond inserts still have a deterministic newest-50.
  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.clubMessage.create({
      data: { clubId: loaded.club.id, authorId: userId, body: text },
    })
    const stale = await tx.clubMessage.findMany({
      where: { clubId: loaded.club.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: CLUB_MESSAGE_CAP,
      select: { id: true },
    })
    if (stale.length > 0) {
      await tx.clubMessage.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } })
    }
    return created
  })

  const author = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } })
  const payload = toPayload(message, author?.username ?? userId)
  // Best-effort live delivery — a Redis outage must not lose the durable row.
  await publishClubMessage(payload).catch(() => {})

  return Response.json({ message: payload }, { status: 201 })
}

export async function DELETE(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id

  const { slug } = await params
  const loaded = await loadClubMembership(slug, userId)
  if (!loaded) return Response.json({ error: 'not_found' }, { status: 404 })
  if (!loaded.caller) return Response.json({ error: 'forbidden' }, { status: 403 })

  const messageId = new URL(req.url).searchParams.get('messageId')
  if (!messageId) return Response.json({ error: 'invalid_messageId' }, { status: 400 })

  const message = await prisma.clubMessage.findUnique({
    where: { id: messageId },
    select: { id: true, clubId: true, authorId: true },
  })
  // 404 (not 403) when the message doesn't exist or belongs to another club — existence isn't leaked.
  if (!message || message.clubId !== loaded.club.id) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const isSelf = message.authorId === userId
  const isOwner = loaded.club.ownerId === userId
  if (!isSelf && !isOwner && !loaded.caller.isAdmin) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  // Moderation (admin/owner deleting someone else's message) writes an AuditLog row; a
  // self-delete does not — same rule as the Phase 5 Part A Rating moderation pattern.
  await prisma.$transaction(async (tx) => {
    await tx.clubMessage.delete({ where: { id: message.id } })
    if (!isSelf) {
      const actor = await tx.user.findUnique({ where: { id: userId }, select: { username: true } })
      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: 'club.message_remove',
          targetType: 'club_message',
          targetId: message.id,
          summary: `${actor?.username ?? userId} hat eine Chat-Nachricht im Club ${slug} entfernt (Moderation)`,
        },
      })
    }
  })

  return Response.json({ ok: true }, { status: 200 })
}
