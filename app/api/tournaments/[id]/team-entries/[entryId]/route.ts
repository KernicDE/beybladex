// app/api/tournaments/[id]/team-entries/[entryId]/route.ts (RC15, issue #12)
// Team-registration withdrawal. AUTHZ RULE: the entry's team CAPTAIN (or an ADMIN) withdraws
// the team — same authority tier as registration.
// WINDOW: up until Tournament.startDate (mirrors the solo join DELETE). After start the entry
// may carry live bracket state, so withdrawal then is refused with bracket_exists — team
// no-show/auto-advance handling mid-event is deliberately out of this milestone's scope
// (documented in the PR); the withdrawn flag exists for the pre-generation pool exactly like
// TournamentParticipant.withdrawn.
import { requireUser, getCallerRole } from '@/lib/guards'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { invalidatePublicCache, publicTournamentKey } from '@/lib/publicCache'

type Ctx = { params: Promise<{ id: string; entryId: string }> }

export async function DELETE(_req: Request, { params }: Ctx) {
  const gate = await requireUser()
  if ('error' in gate) return gate.error
  const { allowed } = await rateLimit(`tournament:team-join:${gate.userId}`, 60, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })
  const { id, entryId } = await params

  const entry = await prisma.teamTournamentEntry.findUnique({
    where: { id: entryId },
    include: { team: { include: { members: true } } },
  })
  if (!entry || entry.tournamentId !== id) return Response.json({ error: 'not_found' }, { status: 404 })

  const isCaptain = entry.team.members.some((m) => m.userId === gate.userId && m.role === 'CAPTAIN')
  const role = await getCallerRole(gate.userId)
  if (!isCaptain && role !== 'ADMIN') return Response.json({ error: 'forbidden' }, { status: 403 })

  const tournament = await prisma.tournament.findUnique({ where: { id }, select: { startDate: true } })
  if (!tournament) return Response.json({ error: 'not_found' }, { status: 404 })
  if (new Date() > tournament.startDate) {
    return Response.json({ error: 'tournament_started' }, { status: 409 })
  }

  const inBracket = await prisma.teamMatch.findFirst({
    where: { OR: [{ team1EntryId: entryId }, { team2EntryId: entryId }] },
    select: { id: true },
  })
  if (inBracket) return Response.json({ error: 'bracket_exists' }, { status: 409 })

  await prisma.teamTournamentEntry.delete({ where: { id: entryId } })
  // Hotfix #99: the team list on the cached public detail page changed.
  await invalidatePublicCache(publicTournamentKey(id))
  return new Response(null, { status: 204 })
}
