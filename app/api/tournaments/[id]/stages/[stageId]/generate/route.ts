// app/api/tournaments/[id]/stages/[stageId]/generate/route.ts
// Phase 5 Part C2 — "Bracket generieren / Runde pairen" for ONE stage. Thin controller:
// auth → rate limit → parse arenaCount → lib/stageGenerate.ts (the format dispatch, pool
// resolution, persistence and notification fan-out live there, unit-testable without HTTP) →
// map StageGenerateError 1:1 onto the Response. AUTHZ RULE (standing Global-Constraints
// requirement; negative test in tests/integration/stage-authz.test.ts): only the tournament's
// creator (createdById) or an ADMIN may generate; anyone else gets 403.
//
// Format dispatch (implemented in lib/stageGenerate.ts):
//   SINGLE_ELIMINATION → lib/bracket.ts, persisted with bracketSide = null. Refuses 409
//     (bracket_exists) if the stage already has matches.
//   DOUBLE_ELIMINATION → lib/doubleElimination.ts, bracketSide persisted per match (WINNERS /
//     LOSERS / GRAND_FINAL — the grand-final RESET is generated PENDING and deleted later by the
//     score route if never needed). Refuses 409 (bracket_exists) if matches exist. Requires ≥ 3
//     participants (422 below that — a 2-player double-elimination is degenerate).
//   SWISS → lib/swiss.ts pairSwissRound for the NEXT round. Refuses 409 (round_incomplete) if the
//     current round isn't fully COMPLETED yet, and 409 (swiss_complete) once swissRoundsDone ==
//     swissRounds. Byes are persisted as COMPLETED matches (player2Id null, winnerId = recipient)
//     and an automatic standing win, so pairing/scoring/completion stay uniform.
//   ROUND_ROBIN (Phase 5 Part C3) → lib/roundRobin.ts's full fixture list in ONE shot (circle
//     method; swissRound reused for display grouping, it gates nothing here). Refuses 409
//     (bracket_exists) on a second call — there is no "next round" to pair. Odd-count byes are a
//     scheduling artifact: NO match row is created for the byed player (unlike Swiss, this is not
//     a standing event).
//
// Phase 7 — ARENA MANAGEMENT: the organizer may pass `arenaCount` (integer 1..64, anything else
// is ignored) in the JSON body; lib/arenaAssign.ts's parseArenaCount validates it here and
// lib/stageGenerate.ts persists/applies it.
import { requireUser } from '@/lib/guards'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { parseArenaCount } from '@/lib/arenaAssign'
import { generateStage, StageGenerateError } from '@/lib/stageGenerate'
import { generateTeamStage } from '@/lib/teamStage'
import { invalidatePublicCache, publicTournamentKey } from '@/lib/publicCache'

type Ctx = { params: Promise<{ id: string; stageId: string }> }

export async function POST(req: Request, { params }: Ctx) {
  const gate = await requireUser()
  if ('error' in gate) return gate.error
  // [REVIEW-FIX: backend-security #37] THE expensive one: transactional bracket generation.
  // A bracket is generated once per stage — 15/min/user cannot hinder any real workflow but
  // caps how hard a compromised organizer session can hammer the DB.
  const { allowed } = await rateLimit(`tournament:generate:${gate.userId}`, 15, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })
  const { id, stageId } = await params

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    // no/invalid body is fine — arenaCount is optional
  }

  // RC15 #12 — team tournaments generate TeamMatch encounters (lib/teamStage.ts) over the
  // checked-in team-entry pool instead of solo matches; arenaCount is a solo-match concept
  // and is ignored in team mode.
  const teamMode = (await prisma.tournament.findUnique({ where: { id }, select: { teamMode: true } }))?.teamMode ?? false

  try {
    const result = teamMode
      ? await generateTeamStage({ userId: gate.userId, tournamentId: id, stageId })
      : await generateStage({ userId: gate.userId, tournamentId: id, stageId, arenaCount: parseArenaCount(body.arenaCount) })
    // Hotfix #99: matches now exist — the cached public detail page's bracket preview changed.
    if (result.status >= 200 && result.status < 300) {
      await invalidatePublicCache(publicTournamentKey(id))
    }
    return Response.json(result.payload, { status: result.status })
  } catch (e) {
    if (e instanceof StageGenerateError) return Response.json(e.payload, { status: e.status })
    throw e
  }
}
