// app/api/notifications/stream/route.ts (Phase 3)
// Server-Sent Events stream for the notification inbox.
//
// - Authorization: verifies the NextAuth session BEFORE subscribing; 401 without one. The
//   stream subscribes ONLY to `notify:{session.user.id}` on redisSubscriber — never a global
//   channel (that would leak every user's notifications to every connected client,
//   [REVIEW-FIX: frontend-pwa I9]), and never the command connection (a subscriber-mode
//   ioredis connection rejects ordinary commands — see lib/redis.ts).
// - Backfill on connect: `?since=<ISO timestamp>` replays Notification rows created after
//   that timestamp (bounded to take: 200 — older gaps are covered by the paginated
//   GET /api/notifications list, not an unbounded replay [REVIEW-FIX: performance P3]).
// - Heartbeat comment (`: ping\n\n`) every 25s keeps the connection alive through Traefik.
//   `no-transform` in Cache-Control asks any proxy on the path (incl. Traefik compression)
//   not to buffer or transform the stream [REVIEW-FIX: performance 6b].
// - Client-side, default EventSource reconnect is sufficient: a Watchtower redeploy drops
//   connections for a ~1s blip that auto-reconnects, backfilled by the `?since` replay.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { redisSubscriber } from '@/lib/redis'
import { notifyChannel } from '@/lib/notify'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HEARTBEAT_MS = 25_000
const REPLAY_LIMIT = 200

// Refcount per channel: the subscriber connection is shared across concurrent SSE requests
// (e.g. two tabs of the same user), so unsubscribe only when the LAST client disconnects.
const channelRefCount = new Map<string, number>()

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: 'unauthorized' }, { status: 401 })
  }
  const userId = session.user.id
  const channel = notifyChannel(userId)

  // Backfill: replay rows newer than the client's last-seen timestamp, oldest first.
  let backlog: Awaited<ReturnType<typeof loadBacklog>> = []
  const sinceRaw = new URL(req.url).searchParams.get('since')
  if (sinceRaw) {
    const since = new Date(sinceRaw)
    if (!Number.isNaN(since.getTime()) && since.getTime() <= Date.now()) {
      backlog = await loadBacklog(userId, since)
    }
  }

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

function loadBacklog(userId: string, since: Date) {
  return prisma.notification.findMany({
    where: { userId, createdAt: { gt: since } },
    orderBy: { createdAt: 'asc' },
    take: REPLAY_LIMIT,
  })
}
