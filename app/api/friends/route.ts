// app/api/friends/route.ts (Phase 4)
// POST — send a friend request.
//
// Authorization rule (documented per Global Constraints): any authenticated user may send a
// request to any other existing user, with these guard rails:
//   400 — addresseeId missing/invalid, or the requester names themselves
//   404 — the addressee does not exist (existence of arbitrary user ids is not confirmed
//         beyond what a profile URL already exposes — same policy as the profile page)
//   409 — a Friendship row already exists between the pair in EITHER direction. The
//         @@unique([requesterId, addresseeId]) constraint is directional, so the reverse
//         pair (addressee already requested requester) is checked manually before insert;
//         a BLOCKED row in either direction also 409s — the blocked party cannot re-request.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { friendshipBetween } from '@/lib/friendship'
import { notifyUser } from '@/lib/notify'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const requesterId = session.user.id

  const { allowed } = await rateLimit(`friends:post:${requesterId}`, 30, 60)
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

  const addresseeId = (body as Record<string, unknown>).addresseeId
  if (typeof addresseeId !== 'string' || addresseeId.length === 0) {
    return Response.json({ error: 'invalid_addressee' }, { status: 400 })
  }
  if (addresseeId === requesterId) {
    return Response.json({ error: 'cannot_request_self' }, { status: 400 })
  }

  const addressee = await prisma.user.findUnique({ where: { id: addresseeId }, select: { id: true } })
  if (!addressee) return Response.json({ error: 'not_found' }, { status: 404 })

  // Reverse-direction check happens here (the unique constraint only covers same-direction);
  // any existing row — PENDING, ACCEPTED, or BLOCKED — means no new request may be created.
  const existing = await friendshipBetween(requesterId, addresseeId)
  if (existing) return Response.json({ error: 'already_exists', status: existing.status }, { status: 409 })

  const friendship = await prisma.friendship.create({
    data: { requesterId, addresseeId, status: 'PENDING' },
    select: { id: true, requesterId: true, addresseeId: true, status: true, createdAt: true },
  })

  // Phase 10 item 9 — real gap found by the user: nothing ever notified the addressee of an
  // incoming request; the only way to discover one was chance revisiting of the requester's
  // profile. Reuse lib/notify.ts's notifyUser (no second notification mechanism) — link goes
  // to the requester's profile, where the existing Annehmen/Ablehnen buttons already work.
  const requester = await prisma.user.findUnique({ where: { id: requesterId }, select: { username: true, displayName: true } })
  await notifyUser(addresseeId, {
    title: 'Neue Freundschaftsanfrage',
    message: `${requester?.displayName ?? requester?.username ?? 'Jemand'} möchte mit dir befreundet sein.`,
    link: `/profile/${requester?.username}`,
  })

  return Response.json(friendship, { status: 201 })
}
