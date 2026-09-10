// app/api/push/subscribe/route.ts (Phase 18 item 1)
// POST — register (or re-register) a browser's Push subscription for the caller. Session
// required (401 anonymous). Upserts by `endpoint` (the browser-assigned subscription URL is
// the natural unique key — a page re-subscribing after a permission re-grant, or on a second
// tab, sends the same endpoint and must not create a duplicate row).
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })

  const { allowed } = await rateLimit(`push:subscribe:${session.user.id}`, 20, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null) return Response.json({ error: 'invalid_body' }, { status: 400 })
  const b = body as Record<string, unknown>
  const endpoint = b.endpoint
  const keys = b.keys as Record<string, unknown> | undefined
  const p256dh = keys?.p256dh
  const auth_ = keys?.auth
  if (typeof endpoint !== 'string' || endpoint.length === 0 || typeof p256dh !== 'string' || typeof auth_ !== 'string') {
    return Response.json({ error: 'invalid_subscription' }, { status: 400 })
  }

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    // A subscription that gets RE-created under the same endpoint (rare, but the browser's own
    // contract doesn't forbid it) may belong to a different signed-in user on a shared device —
    // always re-point it at the CURRENT caller rather than silently keeping the old owner.
    create: { userId: session.user.id, endpoint, p256dh, auth: auth_ },
    update: { userId: session.user.id, p256dh, auth: auth_ },
  })

  return Response.json({ ok: true }, { status: 201 })
}
