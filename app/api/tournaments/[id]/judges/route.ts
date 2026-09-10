// app/api/tournaments/[id]/judges/route.ts (Phase 7)
// Manage a tournament's TournamentJudge roster — the "is this a judge of THIS tournament"
// authz tier that lib/tournamentJudges.ts's isTournamentStaff checks for the QR check-in,
// arena check-in, and payment routes. AUTHZ RULE (standing Global-Constraints requirement):
// granting/revoking judge status is organizer(createdById)/ADMIN-only — NOT delegatable to
// existing judges — anyone else gets 403. The target user must hold the global JUDGE or
// ADMIN role (matching the existing per-match judge-assign route's same invariant).
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

type Ctx = { params: Promise<{ id: string }> }

async function requireOrganizer(id: string, callerId: string) {
  const tournament = await prisma.tournament.findUnique({ where: { id }, select: { createdById: true } })
  if (!tournament) return { error: Response.json({ error: 'not_found' }, { status: 404 }) } as const
  const caller = await prisma.user.findUnique({ where: { id: callerId }, select: { role: true } })
  if (tournament.createdById !== callerId && caller?.role !== 'ADMIN') {
    return { error: Response.json({ error: 'forbidden' }, { status: 403 }) } as const
  }
  return {} as const
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params
  const judges = await prisma.tournamentJudge.findMany({
    where: { tournamentId: id },
    select: { userId: true, user: { select: { username: true, displayName: true } } },
    orderBy: { createdAt: 'asc' },
  })
  return Response.json({ judges })
}

export async function POST(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const authz = await requireOrganizer(id, session.user.id)
  if ('error' in authz) return authz.error

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

export async function DELETE(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const authz = await requireOrganizer(id, session.user.id)
  if ('error' in authz) return authz.error

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
