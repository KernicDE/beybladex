// app/api/teams/[slug]/messages/stream/route.ts (issue #198)
// Server-Sent Events stream for team chat. Mirrors app/api/clubs/[slug]/messages/stream/route.ts —
// session + TeamMembership verified BEFORE subscribing (401/404/403 same as the club version),
// subscribes ONLY to `team-chat:{teamId}` on redisSubscriber, 25s heartbeat, full up-to-cap
// backfill on every (re)connect (no ?since= needed since the buffer itself is bounded).
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { redisSubscriber } from '@/lib/redis'
import { TEAM_MESSAGE_CAP, teamChatChannel, type TeamChatMessagePayload } from '@/lib/teamChat'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HEARTBEAT_MS = 25_000

type Ctx = { params: Promise<{ slug: string }> }

const channelRefCount = new Map<string, number>()

export async function GET(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const userId = session.user.id

  const { slug } = await params
  const team = await prisma.team.findUnique({ where: { slug }, select: { id: true } })
  if (!team) return Response.json({ error: 'not_found' }, { status: 404 })
  const membership = await prisma.teamMember.findUnique({
    where: { teamId_userId: { teamId: team.id, userId } },
    select: { userId: true },
  })
  if (!membership) return Response.json({ error: 'forbidden' }, { status: 403 })

  const channel = teamChatChannel(team.id)

  const rows = await prisma.teamMessage.findMany({
    where: { teamId: team.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: TEAM_MESSAGE_CAP,
  })
  const authors = await prisma.user.findMany({
    where: { id: { in: rows.map((r) => r.authorId) } },
    select: { id: true, username: true },
  })
  const authorNames = new Map(authors.map((a) => [a.id, a.username]))
  const backlog: TeamChatMessagePayload[] = rows.map((r) => ({
    id: r.id, teamId: r.teamId, authorId: r.authorId, body: r.body,
    authorName: authorNames.get(r.authorId) ?? r.authorId, createdAt: r.createdAt.toISOString(),
  }))

  const encoder = new TextEncoder()
  let cleanup: () => void = () => {}
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
      for (const row of backlog) send(row)

      const onMessage = (received: string, message: string) => {
        if (received !== channel) return
        try {
          send(JSON.parse(message))
        } catch {
          // a malformed publish must not kill the stream
        }
      }

      let done = false
      cleanup = () => {
        if (done) return
        done = true
        clearInterval(heartbeat)
        redisSubscriber.off('message', onMessage)
        const remaining = (channelRefCount.get(channel) ?? 1) - 1
        if (remaining <= 0) {
          channelRefCount.delete(channel)
          redisSubscriber.unsubscribe(channel).catch(() => {})
        } else {
          channelRefCount.set(channel, remaining)
        }
      }

      redisSubscriber.on('message', onMessage)
      channelRefCount.set(channel, (channelRefCount.get(channel) ?? 0) + 1)
      if (channelRefCount.get(channel) === 1) await redisSubscriber.subscribe(channel)

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          // stream already closed; cleanup runs via the abort handler
        }
      }, HEARTBEAT_MS)

      req.signal.addEventListener('abort', () => {
        cleanup()
        try {
          controller.close()
        } catch {
          // already closed
        }
      })
    },
    cancel() {
      cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
