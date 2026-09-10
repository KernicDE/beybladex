// app/api/tournaments/[id]/start/route.ts (Phase 16 item 6)
// POST — "Turnier starten". AUTHZ RULE (standing Global-Constraints requirement): owner
// (createdById) or ADMIN only, same tier as every other OrganizerConsole action.
//
// ONE-WAY ACTION: sets Tournament.startedAt = now() — no "un-start". A second call once
// startedAt is already set is a 409 (already_started), never a silent no-op re-stamp.
//
// DECK LOCK-IN (binding decision, master plan Phase 16 item 6): if the tournament's linked
// Ruleset has lockedDecks: true, every registered TournamentParticipant's CURRENT deck builds
// are SNAPSHOTTED into lockedBuildIds, in the SAME transaction as startedAt — not a live
// reference to the Deck (a Deck is a personal, reusable object that may be registered for
// other, not-yet-started tournaments too; locking the Deck row itself would incorrectly block
// editing it for an unrelated event). A participant with no deckId is skipped (nothing to
// snapshot — their lockedBuildIds stays empty, same as if lockedDecks were false). If
// lockedDecks is false, no snapshot is taken at all — the live Deck keeps being read match-by-
// match as before this phase.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  const tournament = await prisma.tournament.findUnique({
    where: { id },
    select: { createdById: true, startedAt: true, ruleset: { select: { lockedDecks: true } } },
  })
  if (!tournament) return Response.json({ error: 'not_found' }, { status: 404 })
  const caller = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
  if (tournament.createdById !== session.user.id && caller?.role !== 'ADMIN') {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  if (tournament.startedAt) return Response.json({ error: 'already_started' }, { status: 409 })

  const startedAt = await prisma.$transaction(async (tx) => {
    const updated = await tx.tournament.update({ where: { id }, data: { startedAt: new Date() } })

    if (tournament.ruleset.lockedDecks) {
      const participants = await tx.tournamentParticipant.findMany({
        where: { tournamentId: id, withdrawn: false, deckId: { not: null } },
        select: { id: true, deckId: true },
      })
      for (const p of participants) {
        const deckBuilds = await tx.deckBuild.findMany({
          where: { deckId: p.deckId! },
          orderBy: { position: 'asc' },
          select: { buildId: true },
        })
        await tx.tournamentParticipant.update({
          where: { id: p.id },
          data: { lockedBuildIds: deckBuilds.map((db) => db.buildId) },
        })
      }
    }
    return updated.startedAt
  })

  return Response.json({ startedAt })
}
