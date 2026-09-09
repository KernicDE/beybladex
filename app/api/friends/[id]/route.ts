// app/api/friends/[id]/route.ts (Phase 4)
// PATCH — transition an existing Friendship:
//   { action: 'accept' } — ONLY the addressee may accept, and only from PENDING → ACCEPTED.
//     The requester accepting their own outgoing request is 403; any non-party is 404 (the
//     row's existence is not leaked to outsiders — same 404-not-403 policy as private rulesets).
//   { action: 'block' } — EITHER party may block, from PENDING or ACCEPTED → BLOCKED.
// DELETE — remove the row entirely (unfriend an ACCEPTED friendship, cancel a PENDING
//   request as either side, or unblock). Either party may DELETE, any status; non-parties 404.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

async function loadRow(
  id: string,
  userId: string,
): Promise<
  | { error: Response }
  | { row: NonNullable<Awaited<ReturnType<typeof prisma.friendship.findUnique>>> }
> {
  const row = await prisma.friendship.findUnique({ where: { id } })
  if (!row) return { error: Response.json({ error: 'not_found' }, { status: 404 }) }
  if (row.requesterId !== userId && row.addresseeId !== userId) {
    return { error: Response.json({ error: 'not_found' }, { status: 404 }) }
  }
  return { row }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id

  const { allowed } = await rateLimit(`friends:patch:${userId}`, 30, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  const { id } = await ctx.params
  const loaded = await loadRow(id, userId)
  if ('error' in loaded) return loaded.error
  const { row } = loaded

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const action = (body as Record<string, unknown> | null)?.action
  if (action !== 'accept' && action !== 'block') {
    return Response.json({ error: 'invalid_action' }, { status: 400 })
  }

  if (action === 'accept') {
    // Negative authz (standing rule): only the addressee accepts; the requester gets 403.
    if (row.addresseeId !== userId) {
      return Response.json({ error: 'forbidden' }, { status: 403 })
    }
    if (row.status !== 'PENDING') {
      return Response.json({ error: 'invalid_transition', status: row.status }, { status: 409 })
    }
  } else {
    // block: either party, but only out of PENDING or ACCEPTED (re-blocking is a no-op 409).
    if (row.status === 'BLOCKED') {
      return Response.json({ error: 'invalid_transition', status: row.status }, { status: 409 })
    }
  }

  const updated = await prisma.friendship.update({
    where: { id: row.id },
    data: { status: action === 'accept' ? 'ACCEPTED' : 'BLOCKED' },
    select: { id: true, requesterId: true, addresseeId: true, status: true },
  })
  return Response.json(updated, { status: 200 })
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const userId = session.user.id

  const { allowed } = await rateLimit(`friends:delete:${userId}`, 30, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  const { id } = await ctx.params
  const loaded = await loadRow(id, userId)
  if ('error' in loaded) return loaded.error

  await prisma.friendship.delete({ where: { id: loaded.row.id } })
  return Response.json({ deleted: true }, { status: 200 })
}
