// app/api/teams/[slug]/members/route.ts (RC15, issue #12)
// Roster addition. AUTHZ RULE (CAPTAIN tier): only a captain (or ADMIN) adds members — a 3-vs-3
// roster is a competitive commitment, not an open community. The 3-member cap is load-bearing
// (the roster IS the tournament lineup, lib/teams.ts): adding a 4th member is 409 roster_full.
// The target is identified by USERNAME (the natural handle on this platform); they need no
// prior relationship with the team — membership confers no data access beyond the public.
import { requireUser } from '@/lib/guards'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { MAX_TEAM_MEMBERS } from '@/lib/teams'
import { authorizeTeamCaptain } from '@/lib/teamAuth'

type Ctx = { params: Promise<{ slug: string }> }

export async function POST(req: Request, { params }: Ctx) {
  const gate = await requireUser()
  if ('error' in gate) return gate.error
  const { allowed } = await rateLimit(`teams:members:${gate.userId}`, 30, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })
  const { slug } = await params

  const authz = await authorizeTeamCaptain(slug, gate.userId)
  if (authz.error) return authz.error

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : ''
  if (username.length === 0) return Response.json({ error: 'invalid_username' }, { status: 400 })

  if (authz.team.members.length >= MAX_TEAM_MEMBERS) {
    return Response.json({ error: 'roster_full' }, { status: 409 })
  }
  const target = await prisma.user.findUnique({ where: { username }, select: { id: true } })
  if (!target) return Response.json({ error: 'user_not_found' }, { status: 404 })
  if (authz.team.members.some((m) => m.userId === target.id)) {
    return Response.json({ error: 'already_member' }, { status: 409 })
  }

  try {
    await prisma.teamMember.create({ data: { teamId: authz.team.id, userId: target.id, role: 'MEMBER' } })
  } catch (e) {
    // P2002: the @@unique([teamId, userId]) pair raced in — same answer as the check above.
    if (e && typeof e === 'object' && 'code' in e && e.code === 'P2002') {
      return Response.json({ error: 'already_member' }, { status: 409 })
    }
    throw e
  }
  return Response.json({ ok: true }, { status: 201 })
}
