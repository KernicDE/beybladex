// app/api/teams/[slug]/messages/route.ts (issue #198)
// Team chat: post, list, delete messages. Mirrors app/api/clubs/[slug]/messages/route.ts —
// AUTHZ RULES (standing Global-Constraints requirement):
// - GET  — only current TeamMembers (any role); 401 without a session, 404 for an unknown slug
//   (existence-leak policy, matching every other team route), 403 for a non-member.
// - POST — same authz as GET, plus a per-user-per-team rate limit (10/minute). The
//   TEAM_MESSAGE_CAP is enforced SYNCHRONOUSLY in the SAME transaction as the insert (same
//   binding decision as Phase 12 club chat).
// - DELETE (?messageId=) — the author may delete their own message; a team CAPTAIN or ADMIN
//   may delete ANY message (moderation, reusing the club-chat pattern). Deleting a
//   nonexistent/other-team messageId is 404 (existence isn't leaked).
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { getCallerRole } from '@/lib/guards'
import { TEAM_MESSAGE_CAP, publishTeamMessage, type TeamChatMessagePayload } from '@/lib/teamChat'

const BODY_MAX = 500 // bio-convention free-text cap, same as club chat
const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW_S = 60

type Ctx = { params: Promise<{ slug: string }> }

async function loadTeamMembership(slug: string, userId: string) {
  const team = await prisma.team.findUnique({ where: { slug }, select: { id: true } })
  if (!team) return null
  const caller = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId: team.id, userId } },
    select: { role: true },
  })
  return { team, caller }
}

function toPayload(row: { id: string; teamId: string; authorId: string; body: string; createdAt: Date }, authorName: string): TeamChatMessagePayload {
  return { id: row.id, teamId: row.teamId, authorId: row.authorId, authorName, body: row.body, createdAt: row.createdAt.toISOString() }
}

export async function GET(_req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { slug } = await params
  const loaded = await loadTeamMembership(slug, session.user.id)
  if (!loaded) return Response.json({ error: 'not_found' }, { status: 404 })
  if (!loaded.caller) return Response.json({ error: 'forbidden' }, { status: 403 })

  const rows = await prisma.teamMessage.findMany({
    where: { teamId: loaded.team.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: TEAM_MESSAGE_CAP,
  })
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
  const loaded = await loadTeamMembership(slug, userId)
  if (!loaded) return Response.json({ error: 'not_found' }, { status: 404 })
  if (!loaded.caller) return Response.json({ error: 'forbidden' }, { status: 403 })

  const { allowed } = await rateLimit(`team-chat:post:${loaded.team.id}:${userId}`, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_S)
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

  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.teamMessage.create({
      data: { teamId: loaded.team.id, authorId: userId, body: text },
    })
    const stale = await tx.teamMessage.findMany({
      where: { teamId: loaded.team.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: TEAM_MESSAGE_CAP,
      select: { id: true },
    })
    if (stale.length > 0) {
      await tx.teamMessage.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } })
    }
    return created
  })

  const author = await prisma.user.findUnique({ where: { id: userId }, select: { username: true } })
  const payload = toPayload(message, author?.username ?? userId)
  await publishTeamMessage(payload).catch(() => {})

  return Response.json({ message: payload }, { status: 201 })
}

export async function DELETE(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id

  const { slug } = await params
  const loaded = await loadTeamMembership(slug, userId)
  if (!loaded) return Response.json({ error: 'not_found' }, { status: 404 })
  if (!loaded.caller) return Response.json({ error: 'forbidden' }, { status: 403 })

  const messageId = new URL(req.url).searchParams.get('messageId')
  if (!messageId) return Response.json({ error: 'invalid_messageId' }, { status: 400 })

  const message = await prisma.teamMessage.findUnique({
    where: { id: messageId },
    select: { id: true, teamId: true, authorId: true },
  })
  if (!message || message.teamId !== loaded.team.id) {
    return Response.json({ error: 'not_found' }, { status: 404 })
  }

  const isSelf = message.authorId === userId
  const isCaptain = loaded.caller.role === 'CAPTAIN'
  const role = isSelf || isCaptain ? null : await getCallerRole(userId)
  if (!isSelf && !isCaptain && role !== 'ADMIN') {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  await prisma.$transaction(async (tx) => {
    await tx.teamMessage.delete({ where: { id: message.id } })
    if (!isSelf) {
      const actor = await tx.user.findUnique({ where: { id: userId }, select: { username: true } })
      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: 'team.message_remove',
          targetType: 'team_message',
          targetId: message.id,
          summary: `${actor?.username ?? userId} hat eine Chat-Nachricht im Team ${slug} entfernt (Moderation)`,
        },
      })
    }
  })

  return Response.json({ ok: true }, { status: 200 })
}
