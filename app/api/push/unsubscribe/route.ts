// app/api/push/unsubscribe/route.ts (Phase 18 item 1)
// DELETE — remove a Push subscription. Self-only: a caller may only delete their OWN
// subscription rows (standing Global-Constraints requirement — negative test in
// tests/integration/push-subscribe.test.ts). Deleting by endpoint (not id) mirrors what the
// client actually has on hand (PushSubscription.unsubscribe() returns the endpoint, not a DB id).
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

export async function DELETE(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const endpoint = (body as Record<string, unknown> | null)?.endpoint
  if (typeof endpoint !== 'string' || endpoint.length === 0) {
    return Response.json({ error: 'invalid_endpoint' }, { status: 400 })
  }

  // Self-only via a compound where, not a separate ownership check: deleteMany simply matches
  // nothing (204, not 403/404) if the endpoint belongs to someone else or doesn't exist —
  // existence of another user's subscription is never confirmed either way.
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: session.user.id } })
  return new Response(null, { status: 204 })
}
