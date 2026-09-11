// app/api/teams/[slug]/route.ts (RC15, issue #12)
// Team settings + disband. AUTHZ RULE (CAPTAIN tier, lib/teamAuth.ts): rename / change club
// affiliation / disband require a TeamMember CAPTAIN row for THIS team or an ADMIN role.
// - PATCH: body.name (re-validated, slug stays stable — a renamed team must not break shared
//   links) and/or body.clubId (null clears the affiliation; a set value requires an ACTIVE
//   membership of that club, same rule as creation).
// - DELETE: disbands the team (members/entries cascade). Refused (409 team_competing) while
//   the team is registered in a started, not-yet-completed tournament — silently removing a
//   team from a live event would corrupt the bracket.
import { requireUser } from '@/lib/guards'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { validateTeamName } from '@/lib/teams'
import { authorizeTeamCaptain } from '@/lib/teamAuth'
import { getActiveMembership } from '@/lib/clubMembers'

type Ctx = { params: Promise<{ slug: string }> }

export async function PATCH(req: Request, { params }: Ctx) {
  const gate = await requireUser()
  if ('error' in gate) return gate.error
  const { allowed } = await rateLimit(`teams:edit:${gate.userId}`, 30, 60)
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

  const data: { name?: string; clubId?: string | null } = {}
  if (body.name !== undefined) {
    const nameCheck = validateTeamName(body.name)
    if (!nameCheck.ok) return Response.json({ error: nameCheck.error }, { status: 400 })
    data.name = nameCheck.name
  }
  if (body.clubId !== undefined) {
    if (body.clubId !== null && typeof body.clubId !== 'string') {
      return Response.json({ error: 'invalid_club' }, { status: 400 })
    }
    if (typeof body.clubId === 'string') {
      const club = await prisma.club.findUnique({ where: { id: body.clubId }, select: { id: true } })
      if (!club) return Response.json({ error: 'club_not_found' }, { status: 404 })
      const caller = await prisma.user.findUnique({ where: { id: gate.userId }, select: { role: true } })
      if (caller?.role !== 'ADMIN' && !(await getActiveMembership(body.clubId, gate.userId))) {
        return Response.json({ error: 'forbidden' }, { status: 403 })
      }
    }
    data.clubId = body.clubId
  }

  const updated = await prisma.team.update({ where: { id: authz.team.id }, data, select: { id: true, name: true, slug: true, clubId: true } })
  return Response.json(updated)
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const gate = await requireUser()
  if ('error' in gate) return gate.error
  const { allowed } = await rateLimit(`teams:disband:${gate.userId}`, 30, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })
  const { slug } = await params

  const authz = await authorizeTeamCaptain(slug, gate.userId)
  if (authz.error) return authz.error

  const competing = await prisma.teamTournamentEntry.findFirst({
    where: {
      teamId: authz.team.id,
      tournament: { startedAt: { not: null }, completedAt: null },
    },
    select: { id: true },
  })
  if (competing) return Response.json({ error: 'team_competing' }, { status: 409 })

  await prisma.team.delete({ where: { id: authz.team.id } })
  return new Response(null, { status: 204 })
}
