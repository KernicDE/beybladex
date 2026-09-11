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
import { rateLimit } from '@/lib/rateLimit'
import { notifyTournamentStarted } from '@/lib/notify'
import { invalidatePublicCache, publicTournamentKey } from '@/lib/publicCache'

type Ctx = { params: Promise<{ id: string }> }

export async function POST(_req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  // [REVIEW-FIX: backend-security #37] one-way, lock-in-heavy action; 30/min/user leaves every
  // legitimate "Turnier starten" workflow untouched while bounding request flooding.
  const { allowed } = await rateLimit(`tournament:start:${session.user.id}`, 30, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })
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

  // [REVIEW-FIX P16-3] the original version read startedAt OUTSIDE the transaction, then did an
  // unconditional update inside it — two concurrent POSTs both passed the null check above and
  // both proceeded, so the SECOND one re-stamped startedAt and re-snapshotted against
  // whatever the live decks looked like by then, breaking the "one-way, no silent re-stamp"
  // claim. Fixed: the actual guard is now the CONDITIONAL updateMany inside the transaction
  // (WHERE startedAt IS NULL) — only one concurrent caller can ever match count 1; the loser
  // gets a clean 409 instead of silently re-running the snapshot.
  let result: { startedAt: Date } | 'already_started'
  try {
    result = await prisma.$transaction(async (tx) => {
      const claimed = await tx.tournament.updateMany({ where: { id, startedAt: null }, data: { startedAt: new Date() } })
      if (claimed.count === 0) {
        // Lost the race (or started between the read above and here) — surface as the same
        // conflict the pre-check above would have given a slightly-earlier caller.
        throw new Error('ALREADY_STARTED_RACE')
      }
      const updated = await tx.tournament.findUniqueOrThrow({ where: { id }, select: { startedAt: true } })

      if (tournament.ruleset.lockedDecks) {
        // [REVIEW-FIX P16-4] snapshot EVERY registered TournamentParticipant row, including
        // withdrawn ones — the plan says "every", and a withdrawn participant re-joining later
        // (if that ever becomes possible) must not end up with a stale/missing snapshot either.
        const participants = await tx.tournamentParticipant.findMany({
          where: { tournamentId: id, deckId: { not: null } },
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
      return { startedAt: updated.startedAt! }
    })
  } catch (e) {
    if (e instanceof Error && e.message === 'ALREADY_STARTED_RACE') {
      return Response.json({ error: 'already_started' }, { status: 409 })
    }
    throw e
  }

  // Phase 18 item 2 — "Turnier gestartet", best-effort (matches the score route's own
  // markMetaDirty precedent): the tournament is already started and persisted above; a
  // notification-delivery hiccup must never fail this already-successful request.
  try {
    await notifyTournamentStarted(id)
  } catch (err) {
    console.error(`[start] notifyTournamentStarted(${id}) failed:`, err)
  }

  // Hotfix #99: starting the tournament changes what the public detail surface may show
  // (started state, deck lock-in side effects); drop the cached public detail query.
  await invalidatePublicCache(publicTournamentKey(id))

  return Response.json({ startedAt: result.startedAt })
}
