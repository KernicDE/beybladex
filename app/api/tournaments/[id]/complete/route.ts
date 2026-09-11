// app/api/tournaments/[id]/complete/route.ts
// Phase 5 Part C — "Turnier abschließen" from the organizer console. AUTHZ RULE (standing
// Global-Constraints requirement): only the tournament's creator or an ADMIN may complete a
// tournament; anyone else gets 403. Sets Tournament.completedAt (additive Phase 5 Part C
// column); idempotent — completing an already-completed tournament returns 200 unchanged.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { invalidatePublicCache, publicTournamentKey } from '@/lib/publicCache'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  // [REVIEW-FIX: backend-security #37] idempotent organizer action; 30/min/user.
  const { allowed } = await rateLimit(`tournament:complete:${session.user.id}`, 30, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })
  const { id } = await params

  const tournament = await prisma.tournament.findUnique({ where: { id }, select: { createdById: true, completedAt: true } })
  if (!tournament) return Response.json({ error: 'not_found' }, { status: 404 })
  const caller = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
  if (tournament.createdById !== session.user.id && caller?.role !== 'ADMIN') {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  const completedAt = tournament.completedAt ?? new Date()
  await prisma.tournament.update({ where: { id }, data: { completedAt } })
  // Hotfix #99: keeps the cached public detail consistent if completion state ever joins the
  // public SELECT; one DEL, same cost as the TTL path it replaces.
  await invalidatePublicCache(publicTournamentKey(id))
  return Response.json({ id, completedAt })
}
