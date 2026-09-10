// app/api/clubs/[slug]/messages/stream/route.ts (Phase 12)
// Server-Sent Events stream for the club chat. Mirrors app/api/notifications/stream/route.ts:
// - Authorization: session + ClubMembership are verified BEFORE subscribing — 401 without a
//   session, 404 for an unknown slug (existence-leak policy), 403 for a non-member. The stream
//   subscribes ONLY to `club-chat:{clubId}` on redisSubscriber — never a global channel (that
//   would leak every club's chat to every connected client) and never the command connection
//   (a subscriber-mode ioredis connection rejects ordinary commands — see lib/redis.ts).
// - Backfill on connect: there is no ?since= here — the stream is bounded by the 50-message
//   cap itself, so backfill is simply "send the current up-to-50 messages", oldest first.
// - Heartbeat comment (`: ping\n\n`) every 25s keeps the connection alive through Traefik.
//   `no-transform` in Cache-Control asks any proxy on the path (incl. Traefik compression)
//   not to buffer or transform the stream [REVIEW-FIX: performance 6b].
// - Client-side, default EventSource reconnect is sufficient: a Watchtower redeploy drops
//   connections for a ~1s blip that auto-reconnects, re-backfilled by the full up-to-50 replay.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { redisSubscriber } from '@/lib/redis'
import { CLUB_MESSAGE_CAP, clubChatChannel, type ClubChatMessagePayload } from '@/lib/clubChat'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HEARTBEAT_MS = 25_000

type Ctx = { params: Promise<{ slug: string }> }

// Refcount per channel: the subscriber connection is shared across concurrent SSE requests
// (e.g. two tabs of the same club), so unsubscribe only when the LAST client disconnects.
const channelRefCount = new Map<string, number>()

export async function GET(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const userId = session.user.id

  const { slug } = await params
  const club = await prisma.club.findUnique({ where: { slug }, select: { id: true } })
  if (!club) return Response.json({ error: 'not_found' }, { status: 404 })
  const membership = await prisma.clubMember.findUnique({
    where: { clubId_userId: { clubId: club.id, userId } },
    select: { userId: true },
  })
  if (!membership) return Response.json({ error: 'forbidden' }, { status: 403 })

  const channel = clubChatChannel(club.id)

  // Backfill: the whole current up-to-50 buffer, oldest first (bounded by the cap itself).
  const rows = await prisma.clubMessage.findMany({
    where: { clubId: club.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: CLUB_MESSAGE_CAP,
  })
  const authors = await prisma.user.findMany({
    where: { id: { in: rows.map((r) => r.authorId) } },
    select: { id: true, username: true },
  })
  const authorNames = new Map(authors.map((a) => [a.id, a.username]))
  const backlog: ClubChatMessagePayload[] = rows.map((r) => ({
    id: r.id, clubId: r.clubId, authorId: r.authorId, body: r.body,
    authorName: authorNames.get(r.authorId) ?? r.authorId, createdAt: r.createdAt.toISOString(),
  }))

  const encoder = new TextEncoder()
  // Single idempotent cleanup shared by the abort listener (client disconnect) and
  // ReadableStream.cancel() — whichever fires first wins; the refcount must only ever
  // decrement once per connection.
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
