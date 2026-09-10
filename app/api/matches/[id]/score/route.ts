// app/api/matches/[id]/score/route.ts
// Phase 5 Part C — judge score submission, offline-sync idempotent.
//
// AUTHZ RULE (standing Global-Constraints requirement; negative test in
// tests/integration/score-authz.test.ts): only (a) the Match's assigned judge (Match.judgeId),
// (b) the parent Tournament's creator (createdById), or (c) a session with the ADMIN role may
// POST. Everyone else — including a JUDGE not assigned to this match — gets 403.
//
// IDEMPOTENCY ([REVIEW-FIX: frontend-pwa C2]): every judge action carries a client-generated
// clientEventId (UUID). Match.clientEventId is unique DB-wide and records the last applied
// event, so a replayed POST (double-flush from the `online` event AND the SW sync event, a
// retried fetch, a double-tap) is a no-op returning the stored state. A POST with a DIFFERENT
// clientEventId for an already-COMPLETED match is a conflict: 409 with both versions in the
// body for manual resolution — never a silent overwrite (adjacent-table judges are a real
// scenario, not an edge case).
//
// POINT CALCULATION reads the Ruleset linked to the parent Tournament — no hardcoded point
// values ([REVIEW-FIX], acceptance criterion "Match point calculation reads its point values
// from the Tournament's linked Ruleset"):
//   Spin=1 · Over=2 · Burst=2 · Xtreme Finish=3 · Out-of-Bounds = 2 if ruleset.outOfBounds2Pts
//   else 1 · Overfinish=2 · Own-Finish = opponent +1 if ruleset.ownFinishPenalty else 0,
//   plus a rematch flag · externalDisturbance/aerialContact = no points, rematch flag, gated
//   by their respective Ruleset toggles (externalDisturbanceRerun / aerialContactRerun).
// Match win = a player reaching targetPoints (finalsTargetPoints for matches in the bracket's
// last round — [Phase 5 Part C] decided interpretation, documented here).
//
// PAYLOAD (full-state, not a delta — duplicate delivery is therefore structurally harmless):
//   { clientEventId, player1BuildId?, player2BuildId?, event?: { type, player }, scorePlayer1,
//     scorePlayer2, status, winnerId? }
// When `event` is present the server recomputes the resulting score from the Ruleset and the
// stored scores, and 422s if the client-computed full state disagrees — a malicious or raced
// client cannot award arbitrary points. When `event` is absent (build confirmation, UNDO),
// the full state is stored after monotonicity checks (scores may never increase except through
// a scored event; a COMPLETED match may not be re-opened by a non-ADMIN caller).
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { markMetaDirty } from '@/lib/metaCache'
import { rateLimit } from '@/lib/rateLimit'
import { assignFreedArena } from '@/lib/arenaAssign'
import { propagateEliminationResult, recordSwissResult } from '@/lib/stageFlow'
import { getActiveSeason, applyMatchResultToRatings } from '@/lib/season'
import { notifyMatchReady } from '@/lib/notify'

type Ctx = { params: Promise<{ id: string }> }

const SCORED_EVENTS = new Set(['SPIN', 'OVER', 'BURST', 'XTREME', 'OUT_OF_BOUNDS', 'OVERFINISH', 'OWN_FINISH'])

function pointsForEvent(type: string, ruleset: { outOfBounds2Pts: boolean; ownFinishPenalty: boolean }): number {
  switch (type) {
    case 'SPIN':
      return 1
    case 'OVER':
    case 'BURST':
    case 'OVERFINISH':
      return 2
    case 'XTREME':
      return 3
    case 'OUT_OF_BOUNDS':
      return ruleset.outOfBounds2Pts ? 2 : 1
    case 'OWN_FINISH':
      return ruleset.ownFinishPenalty ? 1 : 0
    default:
      return 0
  }
}

export async function POST(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const clientEventId = body.clientEventId
  if (typeof clientEventId !== 'string' || clientEventId.length === 0 || clientEventId.length > 64) {
    return Response.json({ error: 'invalid_client_event_id' }, { status: 400 })
  }

  // Abuse-prone endpoint: bounded per-match write rate (standing rate-limit rule). 120/min
  // cannot throttle legitimate judging (a full match is a handful of POSTs) but caps replays.
  const { allowed } = await rateLimit(`score:${id}`, 120, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  const match = await prisma.match.findUnique({
    where: { id },
    include: {
      tournament: {
        include: {
          ruleset: true,
        },
      },
      // Phase 5 Part C2: rounds and finals detection are STAGE-scoped (a stage's round numbering
      // restarts at 1), not tournament-scoped.
      stage: {
        include: {
          matches: { select: { round: true } },
        },
      },
    },
  })
  if (!match) return Response.json({ error: 'not_found' }, { status: 404 })

  const caller = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
  const isAssignedJudge = match.judgeId === session.user.id
  const isOwner = match.tournament.createdById === session.user.id
  const isAdmin = caller?.role === 'ADMIN'
  if (!isAssignedJudge && !isOwner && !isAdmin) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  // Idempotent replay: same clientEventId already applied → no-op, return stored state.
  if (match.clientEventId === clientEventId) {
    return Response.json({
      id: match.id,
      status: match.status,
      scorePlayer1: match.scorePlayer1,
      scorePlayer2: match.scorePlayer2,
      winnerId: match.winnerId,
      clientEventId: match.clientEventId,
      replayed: true,
    })
  }

  // Conflict policy: a different event for an already-completed match is a 409 with both
  // versions surfaced for manual resolution — never a silent overwrite.
  if (match.status === 'COMPLETED') {
    return Response.json(
      {
        error: 'conflict',
        serverVersion: {
          clientEventId: match.clientEventId,
          scorePlayer1: match.scorePlayer1,
          scorePlayer2: match.scorePlayer2,
          winnerId: match.winnerId,
          status: match.status,
        },
        clientVersion: { clientEventId, ...body },
      },
      { status: 409 }
    )
  }

  const ruleset = match.tournament.ruleset
  const event = body.event as { type?: string; player?: number } | undefined
  const type = event?.type
  const player = event?.player

  if (event !== undefined && event !== null) {
    if (typeof type !== 'string' || (player !== 1 && player !== 2)) {
      return Response.json({ error: 'invalid_event' }, { status: 400 })
    }
    const rematchTriggers: Record<string, boolean> = {
      EXTERNAL_DISTURBANCE: ruleset.externalDisturbanceRerun,
      AERIAL_CONTACT: ruleset.aerialContactRerun,
      OWN_FINISH: ruleset.ownFinishPenalty,
    }
    if (!SCORED_EVENTS.has(type) && !(type in rematchTriggers)) {
      return Response.json({ error: 'invalid_event' }, { status: 400 })
    }
  }

  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null)
  const claimedScore1 = num(body.scorePlayer1)
  const claimedScore2 = num(body.scorePlayer2)
  if (claimedScore1 === null || claimedScore2 === null) {
    return Response.json({ error: 'invalid_state' }, { status: 400 })
  }

  let nextScore1 = match.scorePlayer1
  let nextScore2 = match.scorePlayer2
  let rematch = false

  if (type) {
    // Server-authoritative scoring: recompute the delta from the Ruleset, don't trust the
    // client's arithmetic.
    if (SCORED_EVENTS.has(type)) {
      const pts = pointsForEvent(type, ruleset)
      if (type === 'OWN_FINISH') {
        // Own-Finish is a penalty committed BY `player`; the OPPONENT receives the point.
        if (player === 1) nextScore2 += pts
        else nextScore1 += pts
      } else if (player === 1) {
        nextScore1 += pts
      } else {
        nextScore2 += pts
      }
    } else {
      // Rerun events (external disturbance / aerial contact): no points, the round is replayed.
      rematch = true
    }
    if (claimedScore1 !== nextScore1 || claimedScore2 !== nextScore2) {
      return Response.json(
        {
          error: 'state_mismatch',
          serverComputed: { scorePlayer1: nextScore1, scorePlayer2: nextScore2 },
          clientClaimed: { scorePlayer1: claimedScore1, scorePlayer2: claimedScore2 },
        },
        { status: 422 }
      )
    }
  } else {
    // No event: full-state store (build confirmation / UNDO). Scores may only stay or decrease
    // — an increase without a scored event would be an unaudited point award.
    if (claimedScore1 > match.scorePlayer1 || claimedScore2 > match.scorePlayer2) {
      return Response.json({ error: 'invalid_state' }, { status: 422 })
    }
    nextScore1 = claimedScore1
    nextScore2 = claimedScore2
  }

  // Match-start build confirmation ([REVIEW-FIX: ux-product §4]): the judge confirms which of
  // the player's three registered deck builds they're leading with; defaults to the deck's
  // first DeckBuild position client-side.
  const buildId = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined)
  const player1BuildId = buildId(body.player1BuildId)
  const player2BuildId = buildId(body.player2BuildId)

  // Phase 16 item 6 — once a tournament has been started with a locked-decks ruleset, every
  // registered participant's TournamentParticipant.lockedBuildIds is the authoritative build
  // list for their matches: a build confirmation for a build outside that snapshot is rejected.
  // An empty lockedBuildIds (tournament not started yet, or its ruleset doesn't lock decks)
  // means no restriction — the live deck keeps being read as before this phase.
  const tournamentId = match.tournamentId
  async function assertBuildIsLocked(playerId: string | null, buildIdToConfirm: string | undefined): Promise<Response | null> {
    if (!buildIdToConfirm || !playerId) return null
    const participant = await prisma.tournamentParticipant.findUnique({
      where: { tournamentId_userId: { tournamentId, userId: playerId } },
      select: { lockedBuildIds: true },
    })
    if (participant && participant.lockedBuildIds.length > 0 && !participant.lockedBuildIds.includes(buildIdToConfirm)) {
      return Response.json({ error: 'build_not_locked' }, { status: 400 })
    }
    return null
  }
  const player1LockError = await assertBuildIsLocked(match.player1Id, player1BuildId)
  if (player1LockError) return player1LockError
  const player2LockError = await assertBuildIsLocked(match.player2Id, player2BuildId)
  if (player2LockError) return player2LockError

  // Phase 16 item 1-2 — dual-spin mode. Locked at the same moment the build is confirmed;
  // immutable once the match has left PENDING. [REVIEW-FIX P16-1] the original version here
  // only rejected a DIFFERENT value than an already-stored one — a null→value transition (i.e.
  // setting a spin mode for the first time on a request AFTER match start) slipped through
  // uncaught, contradicting "locked at match start". Fixed: once status !== PENDING, ANY
  // submitted value must exactly equal what's already stored (including "nothing stored yet" —
  // a still-undefined field can never be set post-start); only an exact-match resubmit (e.g. a
  // replayed non-idempotent-key request) is a no-op, everything else is 409.
  const spinMode = (v: unknown): 'RIGHT' | 'LEFT' | undefined => (v === 'RIGHT' || v === 'LEFT' ? v : undefined)
  const player1SpinMode = spinMode(body.player1SpinMode)
  const player2SpinMode = spinMode(body.player2SpinMode)
  if (match.status !== 'PENDING') {
    if (player1SpinMode !== undefined && player1SpinMode !== match.player1SpinMode) {
      return Response.json({ error: 'spin_mode_locked' }, { status: 409 })
    }
    if (player2SpinMode !== undefined && player2SpinMode !== match.player2SpinMode) {
      return Response.json({ error: 'spin_mode_locked' }, { status: 409 })
    }
  }

  // [REVIEW-FIX P16-2] a spin mode may only ever be recorded for a build that actually contains
  // a dualSpin part — otherwise an authorized caller (any assigned judge) could attach a
  // meaningless spin mode to an ordinary build, silently feeding a fake entry into the Auto-Meta
  // per-mode buckets (lib/meta.ts). Checked against whichever build is EFFECTIVE for this
  // request (the one just confirmed, or the already-stored one if none is being confirmed here).
  async function assertBuildIsDualSpin(effectiveBuildId: string | undefined): Promise<boolean> {
    if (!effectiveBuildId) return false
    const build = await prisma.build.findUnique({
      where: { id: effectiveBuildId },
      select: { blade: { select: { dualSpin: true } }, ratchet: { select: { dualSpin: true } }, bit: { select: { dualSpin: true } } },
    })
    return build !== null && (build.blade.dualSpin || build.ratchet.dualSpin || build.bit.dualSpin)
  }
  if (player1SpinMode !== undefined) {
    const effectiveBuildId = player1BuildId ?? match.player1BuildId ?? undefined
    if (!(await assertBuildIsDualSpin(effectiveBuildId))) {
      return Response.json({ error: 'not_dual_spin_build' }, { status: 400 })
    }
  }
  if (player2SpinMode !== undefined) {
    const effectiveBuildId = player2BuildId ?? match.player2BuildId ?? undefined
    if (!(await assertBuildIsDualSpin(effectiveBuildId))) {
      return Response.json({ error: 'not_dual_spin_build' }, { status: 400 })
    }
  }

  // Win threshold: finals (the stage's last round) use finalsTargetPoints, earlier rounds
  // targetPoints — read from the Ruleset, never hardcoded. Phase 5 Part C2: the round lookup is
  // scoped to THIS match's STAGE, and a SWISS or ROUND_ROBIN stage never uses finalsTargetPoints
  // (every round is scored at targetPoints; there is no single final match).
  const maxRound = Math.max(0, ...match.stage.matches.map((m) => m.round))
  const isFinal =
    match.stage.format !== 'SWISS' && match.stage.format !== 'ROUND_ROBIN' && match.round > 0 && match.round === maxRound
  const target = isFinal ? ruleset.finalsTargetPoints : ruleset.targetPoints
  const completed = nextScore1 >= target || nextScore2 >= target
  const winnerId = completed ? (nextScore1 > nextScore2 ? match.player1Id : match.player2Id) : null

  const updated = await prisma.match.update({
    where: { id },
    data: {
      scorePlayer1: nextScore1,
      scorePlayer2: nextScore2,
      winnerId,
      status: completed ? 'COMPLETED' : 'IN_PROGRESS',
      clientEventId,
      ...(player1BuildId ? { player1BuildId } : {}),
      ...(player2BuildId ? { player2BuildId } : {}),
      ...(player1SpinMode ? { player1SpinMode } : {}),
      ...(player2SpinMode ? { player2SpinMode } : {}),
    },
  })

  // Phase 5 Part D — Auto-Meta dirty marking: the match just transitioned to COMPLETED, so its
  // two confirmed builds (and transitively their three parts each) are stale in the win-rate
  // cache. Mark them dirty in Redis; the periodic recompute pass
  // (POST /api/internal/recompute-meta, same external scheduler as cleanup-notifications)
  // recomputes exactly those ids. ADDITIVE side effect on the completion path only — replay
  // and 409-conflict requests returned above never reach this, so idempotency is preserved.
  // Best-effort: a Redis failure here must not fail an already-persisted score (the miss only
  // delays the aggregate until the next completion touches these ids).
  if (completed) {
    try {
      const completedBuildIds = [updated.player1BuildId, updated.player2BuildId].filter((v): v is string => Boolean(v))
      if (completedBuildIds.length > 0) {
        const builds = await prisma.build.findMany({
          where: { id: { in: completedBuildIds } },
          select: { bladeId: true, ratchetId: true, bitId: true },
        })
        const partIds = [...new Set(builds.flatMap((b) => [b.bladeId, b.ratchetId, b.bitId]))]
        await markMetaDirty(completedBuildIds, partIds)
      }
    } catch {
      // documented degradation — see comment above
    }
  }

  // Advance the result through the stage — format-aware (Phase 5 Part C2):
  //   SINGLE_ELIMINATION — winner into the next round's slot within this stage (unchanged Part C
  //     behavior, now stage-scoped).
  //   DOUBLE_ELIMINATION — winner into the next WB/LB slot or the grand final; the LOSER also
  //     propagates: a WB match's loser drops into a specific LB slot (lib/doubleElimination.ts's
  //     drop-in mapping), an LB match's loser is eliminated (StageStanding.eliminated = true, no
  //     further propagation). Grand-final reset wiring + stuck-bye resolution happen inside.
  //   SWISS / ROUND_ROBIN — no bracket slots at all (standings-based ranking, not bracket
  //     propagation): both players' StageStanding rows are updated (wins/losses/opponentIds +
  //     buchholz recompute). Swiss re-pairs its next round from them; Round Robin has no next
  //     round — the fixture list was generated in one shot.
  // Idempotent throughout: re-running for the same winner writes the same values.
  if (completed && winnerId) {
    if (match.stage.format === 'SWISS' || match.stage.format === 'ROUND_ROBIN') {
      const loserId = match.player1Id === winnerId ? match.player2Id : match.player1Id
      await recordSwissResult(match.stageId, winnerId, loserId)
    } else if (match.stage.format === 'DOUBLE_ELIMINATION') {
      // The bracket shape depends on slots (nextPow2 of the pool), which the stage's own max
      // round reveals: maxRound = 3R−1 → R = (maxRound + 1) / 3.
      const R = (maxRound + 1) / 3
      await propagateEliminationResult(match, winnerId, 2 ** R)
    } else {
      const slot = match.bracketOrder % 2 === 0 ? 'player1Id' : 'player2Id'
      const nextRound = match.round + 1
      const nextBracketOrder = Math.floor(match.bracketOrder / 2)
      await prisma.match.updateMany({
        where: { stageId: match.stageId, round: nextRound, bracketOrder: nextBracketOrder },
        data: { [slot]: winnerId },
      })
      // Phase 18 item 2 — "Dein nächstes Match beginnt": self-guarded by notifyMatchReady
      // (no-op unless this write was the SECOND slot filled). Best-effort.
      const nextMatch = await prisma.match.findFirst({
        where: { stageId: match.stageId, round: nextRound, bracketOrder: nextBracketOrder },
        select: { id: true },
      })
      if (nextMatch) {
        try {
          await notifyMatchReady(nextMatch.id)
        } catch (err) {
          console.error(`[score] notifyMatchReady(${nextMatch.id}) failed:`, err)
        }
      }
    }

    // Phase 7 — the match just freed its arena: hand the number to the next waiting match in
    // this stage (lib/arenaAssign.ts). No-op when arena management is off (arenaNumber null).
    await assignFreedArena(updated)

    // Phase 14 — Elo update. Gated on the tournament's own rankedEligible flag AND an ACTIVE
    // season existing (a fresh install with no season created yet must not throw — ratings
    // simply don't accrue until an admin creates one). Idempotency is inherited from the
    // early-return replay/409-conflict checks above: this block only runs once per real
    // COMPLETED transition, never on a replayed clientEventId.
    if (match.tournament.rankedEligible && match.player1Id && match.player2Id) {
      const loserId = match.player1Id === winnerId ? match.player2Id : match.player1Id
      const activeSeason = await getActiveSeason(prisma)
      if (activeSeason) {
        await applyMatchResultToRatings(prisma, activeSeason.id, winnerId, loserId)
      }
    }
  }

  return Response.json({
    id: updated.id,
    status: updated.status,
    scorePlayer1: updated.scorePlayer1,
    scorePlayer2: updated.scorePlayer2,
    winnerId: updated.winnerId,
    clientEventId: updated.clientEventId,
    targetPoints: target,
    rematch,
  })
}
