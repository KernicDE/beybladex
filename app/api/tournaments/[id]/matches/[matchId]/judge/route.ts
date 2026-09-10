// app/api/tournaments/[id]/matches/[matchId]/judge/route.ts
// Phase 5 Part C — "Judge zuweisen" from the organizer console. AUTHZ RULE (standing
// Global-Constraints requirement; negative test in tests/integration/organizer-console.test.ts):
// only the tournament's creator or an ADMIN may assign/unassign a match's judge; anyone else
// gets 403. The assignee must hold the JUDGE or ADMIN role (judgeId: null unassigns).
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'

type Ctx = { params: Promise<{ id: string; matchId: string }> }

export async function PATCH(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  // [REVIEW-FIX: backend-security #37] judge assignment churn during live events; 120/min/user
  // keeps pace with console usage while bounding a compromised session.
  const { allowed } = await rateLimit(`tournament:match-judge:${session.user.id}`, 120, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })
  const { id, matchId } = await params

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const judgeId = typeof body.judgeId === 'string' && body.judgeId.length > 0 ? body.judgeId : null

  const tournament = await prisma.tournament.findUnique({ where: { id }, select: { createdById: true } })
  if (!tournament) return Response.json({ error: 'not_found' }, { status: 404 })
  const caller = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
  if (tournament.createdById !== session.user.id && caller?.role !== 'ADMIN') {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  const match = await prisma.match.findFirst({ where: { id: matchId, tournamentId: id } })
  if (!match) return Response.json({ error: 'not_found' }, { status: 404 })

  if (judgeId) {
    const judge = await prisma.user.findUnique({ where: { id: judgeId }, select: { role: true } })
    if (!judge || (judge.role !== 'JUDGE' && judge.role !== 'ADMIN')) {
      return Response.json({ error: 'invalid_judge' }, { status: 400 })
    }
  }

  const updated = await prisma.match.update({ where: { id: matchId }, data: { judgeId } })
  return Response.json({ id: updated.id, judgeId: updated.judgeId })
}
