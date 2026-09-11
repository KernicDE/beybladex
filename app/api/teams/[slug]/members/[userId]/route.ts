// app/api/teams/[slug]/members/[userId]/route.ts (RC15, issue #12)
// Roster removal/leave + role changes. AUTHZ RULES:
// - DELETE: a captain may remove ANY member; a non-captain member may only remove THEMSELVES
//   (leave). The LAST captain cannot leave or be demoted (409 last_captain) — a captainless
//   team could never be managed or registered.
// - PATCH: captains (or ADMIN) set the member's role (CAPTAIN promotion / MEMBER demotion).
//   Demoting the last captain is refused with the same 409.
import { requireUser, getCallerRole } from '@/lib/guards'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { authorizeTeamCaptain } from '@/lib/teamAuth'

type Ctx = { params: Promise<{ slug: string; userId: string }> }

export async function PATCH(req: Request, { params }: Ctx) {
  const gate = await requireUser()
  if ('error' in gate) return gate.error
  const { allowed } = await rateLimit(`teams:members:${gate.userId}`, 30, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })
  const { slug, userId: targetUserId } = await params

  const authz = await authorizeTeamCaptain(slug, gate.userId)
  if (authz.error) return authz.error
  const member = authz.team.members.find((m) => m.userId === targetUserId)
  if (!member) return Response.json({ error: 'not_found' }, { status: 404 })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  if (body.role !== 'CAPTAIN' && body.role !== 'MEMBER') {
    return Response.json({ error: 'invalid_role' }, { status: 400 })
  }
  // Last-captain invariant: a demotion leaving the team without any captain is refused.
  if (member.role === 'CAPTAIN' && body.role === 'MEMBER') {
    const otherCaptain = authz.team.members.some((m) => m.userId !== targetUserId && m.role === 'CAPTAIN')
    if (!otherCaptain) return Response.json({ error: 'last_captain' }, { status: 409 })
  }

  await prisma.teamMember.update({ where: { id: member.id }, data: { role: body.role } })
  return Response.json({ ok: true })
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const gate = await requireUser()
  if ('error' in gate) return gate.error
  const { allowed } = await rateLimit(`teams:members:${gate.userId}`, 30, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })
  const { slug, userId: targetUserId } = await params

  const authz = await authorizeTeamCaptain(slug, gate.userId)
  if (authz.error) return authz.error
  const member = authz.team.members.find((m) => m.userId === targetUserId)
  if (!member) return Response.json({ error: 'not_found' }, { status: 404 })

  const isSelf = targetUserId === gate.userId
  const callerIsCaptain = authz.team.members.some((m) => m.userId === gate.userId && m.role === 'CAPTAIN')
  const callerRole = await getCallerRole(gate.userId)
  // Captains (and ADMIN) may remove anyone; a plain member only themselves.
  if (!isSelf && !callerIsCaptain && callerRole !== 'ADMIN') {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  if (member.role === 'CAPTAIN') {
    const otherCaptain = authz.team.members.some((m) => m.userId !== targetUserId && m.role === 'CAPTAIN')
    if (!otherCaptain) return Response.json({ error: 'last_captain' }, { status: 409 })
  }

  await prisma.teamMember.delete({ where: { id: member.id } })
  return new Response(null, { status: 204 })
}
