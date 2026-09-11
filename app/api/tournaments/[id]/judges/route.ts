// app/api/tournaments/[id]/judges/route.ts (Phase 7)
// Manage a tournament's TournamentJudge roster — the "is this a judge of THIS tournament"
// authz tier that lib/tournamentJudges.ts's isTournamentStaff checks for the QR check-in,
// arena check-in, and payment routes. AUTHZ RULE (standing Global-Constraints requirement):
// granting/revoking judge status is organizer(createdById)/ADMIN-only — NOT delegatable to
// existing judges — anyone else gets 403. The target user must hold the global JUDGE or
// ADMIN role (matching the existing per-match judge-assign route's same invariant).
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { authorizeTournamentOrganizer } from '@/lib/tournamentService'

type Ctx = { params: Promise<{ id: string }> }

// [REVIEW-FIX: backend-security #37] judge-roster edits; 60/min/user.
async function limitJudgeRoster(userId: string): Promise<Response | null> {
  const { allowed } = await rateLimit(`tournament:judges:${userId}`, 60, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })
  return null
}

export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params
  const judges = await prisma.tournamentJudge.findMany({
    where: { tournamentId: id },
    select: { userId: true, user: { select: { username: true, displayName: true } } },
    orderBy: { createdAt: 'asc' },
  })
  return Response.json({ judges })
}

export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const { error: authz } = await authorizeTournamentOrganizer(id, session.user.id, { id: true, createdById: true })
  if (authz) return authz
  const limited = await limitJudgeRoster(session.user.id)
  if (limited) return limited

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const targetUserId = body.userId
  if (typeof targetUserId !== 'string' || targetUserId.length === 0) {
    return Response.json({ error: 'invalid_member' }, { status: 400 })
  }

  const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { role: true } })
  if (!target || (target.role !== 'JUDGE' && target.role !== 'ADMIN')) {
    return Response.json({ error: 'invalid_judge' }, { status: 400 })
  }

  try {
    await prisma.tournamentJudge.create({ data: { tournamentId: id, userId: targetUserId } })
  } catch (e) {
    if (typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002') {
      return Response.json({ error: 'already_judge' }, { status: 409 })
    }
    throw e
  }
  return Response.json({ tournamentId: id, userId: targetUserId }, { status: 201 })
}

export async function DELETE(req: Request, { params }: Ctx): Promise<Response> {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const { error: authz } = await authorizeTournamentOrganizer(id, session.user.id, { id: true, createdById: true })
  if (authz) return authz
  const limited = await limitJudgeRoster(session.user.id)
  if (limited) return limited

  const url = new URL(req.url)
  let targetUserId = url.searchParams.get('userId')
  if (!targetUserId) {
    const body = await req.json().catch(() => ({}))
    if (typeof body.userId === 'string') targetUserId = body.userId
  }
  if (!targetUserId) return Response.json({ error: 'invalid_member' }, { status: 400 })

  const existing = await prisma.tournamentJudge.findUnique({
    where: { tournamentId_userId: { tournamentId: id, userId: targetUserId } },
  })
  if (!existing) return Response.json({ error: 'not_found' }, { status: 404 })

  await prisma.tournamentJudge.delete({ where: { tournamentId_userId: { tournamentId: id, userId: targetUserId } } })
  return new Response(null, { status: 204 })
}
