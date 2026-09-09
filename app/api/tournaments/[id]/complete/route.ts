// app/api/tournaments/[id]/complete/route.ts
// Phase 5 Part C — "Turnier abschließen" from the organizer console. AUTHZ RULE (standing
// Global-Constraints requirement): only the tournament's creator or an ADMIN may complete a
// tournament; anyone else gets 403. Sets Tournament.completedAt (additive Phase 5 Part C
// column); idempotent — completing an already-completed tournament returns 200 unchanged.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const tournament = await prisma.tournament.findUnique({ where: { id }, select: { createdById: true, completedAt: true } })
  if (!tournament) return Response.json({ error: 'not_found' }, { status: 404 })
  const caller = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
  if (tournament.createdById !== session.user.id && caller?.role !== 'ADMIN') {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  const completedAt = tournament.completedAt ?? new Date()
  await prisma.tournament.update({ where: { id }, data: { completedAt } })
  return Response.json({ id, completedAt })
}
