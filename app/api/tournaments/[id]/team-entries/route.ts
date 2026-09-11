// app/api/tournaments/[id]/team-entries/route.ts (RC15, issue #12 — MVP3 3-vs-3)
// TEAM REGISTRATION for a team-mode tournament: "one team, three players' decks".
// AUTHZ RULE: the caller must hold the CAPTAIN role on the registering team (TeamMember) or an
// ADMIN role — registering a competitive roster is the captain's authority, same tier as the
// other team mutations (lib/teamAuth.ts convention).
// RULES:
// - The tournament must be teamMode; solo registrations are refused in team tournaments and
//   team registrations in solo tournaments (both directions, 409).
// - REGISTRATION WINDOW (mirrors the solo join route): closes at the EARLIER of startDate,
//   "Turnier starten" (startedAt), or any team bracket being generated (TeamMatch rows exist).
// - THE LINEUP IS THE ROSTER: exactly the team's 3 members are registered as slots 1..3
//   (deterministic order: joinedAt, then membership id). A team that isn't exactly 3 strong
//   gets 409 team_incomplete / roster_full (lib/teams.ts).
// - A user may only compete for ONE team per tournament: any slot user already registered via
//   another team is 409 already_registered.
// - Decks are NOT chosen here: every slot starts deck-less; each member sets their own slot
//   deck via the slots route (deck ownership is the member's, never the captain's).
import { requireUser, getCallerRole } from '@/lib/guards'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { lineupError } from '@/lib/teams'
import { invalidatePublicCache, publicTournamentKey } from '@/lib/publicCache'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Ctx) {
  const gate = await requireUser()
  if ('error' in gate) return gate.error
  const { allowed } = await rateLimit(`tournament:team-join:${gate.userId}`, 60, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })
  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const teamId = typeof body.teamId === 'string' ? body.teamId : null
  if (!teamId) return Response.json({ error: 'invalid_team' }, { status: 400 })

  const tournament = await prisma.tournament.findUnique({
    where: { id },
    select: {
      startDate: true,
      startedAt: true,
      teamMode: true,
      stages: { select: { _count: { select: { teamMatches: true } } } },
    },
  })
  if (!tournament) return Response.json({ error: 'not_found' }, { status: 404 })
  if (!tournament.teamMode) return Response.json({ error: 'not_team_mode' }, { status: 409 })
  const bracketGenerated = tournament.stages.some((s) => s._count.teamMatches > 0)
  if (new Date() > tournament.startDate || bracketGenerated || tournament.startedAt !== null) {
    return Response.json({ error: 'registration_closed' }, { status: 409 })
  }

  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: { members: { orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }] } },
  })
  if (!team) return Response.json({ error: 'team_not_found' }, { status: 404 })
  const isCaptain = team.members.some((m) => m.userId === gate.userId && m.role === 'CAPTAIN')
  const role = await getCallerRole(gate.userId)
  if (!isCaptain && role !== 'ADMIN') return Response.json({ error: 'forbidden' }, { status: 403 })

  const rosterProblem = lineupError(team.members.length)
  if (rosterProblem) return Response.json({ error: rosterProblem }, { status: 409 })

  const memberIds = team.members.map((m) => m.userId)
  const clash = await prisma.teamTournamentSlot.findFirst({
    where: { entry: { tournamentId: id }, userId: { in: memberIds } },
    select: { entryId: true },
  })
  if (clash) return Response.json({ error: 'already_registered' }, { status: 409 })

  // Entry + the three lineup slots in ONE transaction — a partial lineup must never persist.
  const entry = await prisma.$transaction(async (tx) => {
    const created = await tx.teamTournamentEntry.create({
      data: { tournamentId: id, teamId: team.id },
      select: { id: true },
    })
    await tx.teamTournamentSlot.createMany({
      data: memberIds.map((userId, index) => ({
        entryId: created.id,
        position: index + 1,
        userId,
      })),
    })
    return created
  })
  // Hotfix #99: the team list on the cached public detail page changed.
  await invalidatePublicCache(publicTournamentKey(id))
  return Response.json({ id: entry.id, teamId: team.id }, { status: 201 })
}
