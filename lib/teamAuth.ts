// lib/teamAuth.ts (RC15, issue #12)
// The one CAPTAIN-tier authz contract every team-mutation route shares: a TeamMember row with
// role CAPTAIN for THIS team, or a global ADMIN. Same discriminated-union shape as
// lib/tournamentService.ts's organizer tier (404 when the team does not exist, 403 for
// everyone else) so routes narrow with `if (gate.error) return gate.error`.
import { prisma } from '@/lib/db'
import { getCallerRole } from '@/lib/guards'
import type { Prisma } from '@prisma/client'

type TeamWithMembers = Prisma.TeamGetPayload<{ include: { members: true } }>

export type TeamCaptainAuthz =
  | { error: Response; team: undefined }
  | { error: null; team: TeamWithMembers }

/** CAPTAIN-tier authz for the team identified by its URL slug. */
export async function authorizeTeamCaptain(slug: string, userId: string): Promise<TeamCaptainAuthz> {
  const team = await prisma.team.findUnique({ where: { slug }, include: { members: true } })
  if (!team) {
    return { error: Response.json({ error: 'not_found' }, { status: 404 }), team: undefined }
  }
  const isCaptain = team.members.some((m) => m.userId === userId && m.role === 'CAPTAIN')
  const role = await getCallerRole(userId)
  if (!isCaptain && role !== 'ADMIN') {
    return { error: Response.json({ error: 'forbidden' }, { status: 403 }), team: undefined }
  }
  return { error: null, team }
}
