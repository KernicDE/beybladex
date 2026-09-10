// lib/stageGenerate.ts (RC4, issue #57 — extracted from
// app/api/tournaments/[id]/stages/[stageId]/generate/route.ts)
// The stage-generation CORE LOGIC, HTTP-free and directly unit-testable: format dispatch
// (SINGLE_ELIMINATION / DOUBLE_ELIMINATION / ROUND_ROBIN one-shot fixtures / SWISS next-round
// pairing), participant-pool resolution (stage order 1 = checked-in & present, later stages =
// previous stage's qualifiers), arena assignment, bye advancement, standings seeding and the
// "your next match begins" fan-out. The route handler is a thin controller around this:
// auth → rate limit → parse arenaCount → generateStage → map StageGenerateError to a Response.
//
// ERROR CONTRACT: business outcomes are thrown as StageGenerateError with the EXACT status and
// payload the route previously returned (not_found 404, forbidden 403, stage_completed 409,
// bracket_exists 409, round_incomplete 409, swiss_complete 409, not_enough_participants 422) —
// the route catches and maps them 1:1, so integration tests see identical responses.
import { prisma } from '@/lib/db'
import { assignArenasAtGeneration } from '@/lib/arenaAssign'
import { generateSingleEliminationBracket } from '@/lib/bracket'
import { generateDoubleEliminationBracket } from '@/lib/doubleElimination'
import { pairSwissRound, computeBuchholz, type SwissPlayer } from '@/lib/swiss'
import { generateRoundRobinPairings } from '@/lib/roundRobin'
import { notifyMatchReady } from '@/lib/notify'
import type { Prisma } from '@prisma/client'

export class StageGenerateError extends Error {
  constructor(
    readonly status: number,
    readonly payload: Record<string, unknown>,
  ) {
    super(typeof payload.error === 'string' ? payload.error : 'stage_generate_failed')
  }
}

// Phase 18 item 2 — best-effort "Dein nächstes Match beginnt" fan-out for every newly-created
// match that already has both players (round-robin/Swiss pairings, and round-1 of an
// elimination bracket minus its byes). A notification-delivery hiccup must never fail an
// already-successful generation.
async function notifyReady(matchId: string): Promise<void> {
  try {
    await notifyMatchReady(matchId)
  } catch (err) {
    console.error(`[generate] notifyMatchReady(${matchId}) failed:`, err)
  }
}

export interface GenerateStageArgs {
  userId: string
  tournamentId: string
  stageId: string
  /** Parsed arenaCount override (null = use the tournament's stored value / no arenas). */
  arenaCount: number | null
}

export interface GenerateStageResult {
  status: number
  payload: Record<string, unknown>
}

export async function generateStage({ userId, tournamentId, stageId, arenaCount: bodyArenaCount }: GenerateStageArgs): Promise<GenerateStageResult> {
  const stage = await prisma.tournamentStage.findUnique({
    where: { id: stageId },
    include: {
      matches: { select: { id: true, round: true, bracketOrder: true, status: true, swissRound: true } },
      tournament: { select: { createdById: true, arenaCount: true } },
    },
  })
  if (!stage || stage.tournamentId !== tournamentId) throw new StageGenerateError(404, { error: 'not_found' })
  if (stage.tournament.createdById !== userId && !(await isAdmin(userId))) {
    throw new StageGenerateError(403, { error: 'forbidden' })
  }
  if (stage.status === 'COMPLETED') throw new StageGenerateError(409, { error: 'stage_completed' })

  // Phase 7 — a valid body value overrides/persists; otherwise the stored tournament value applies.
  if (bodyArenaCount !== null) {
    await prisma.tournament.update({ where: { id: tournamentId }, data: { arenaCount: bodyArenaCount } })
  }
  const arenaCount = bodyArenaCount ?? stage.tournament.arenaCount
  const assignArenas = async () => {
    if (arenaCount !== null) await assignArenasAtGeneration(stageId, arenaCount)
  }

  // Participant pool: first stage = checked-in & present (Phase 15: carries each participant's
  // TournamentParticipant.seed — this is the ONLY stage where organizer-set seeding applies;
  // see lib/seeding.ts's own comment on why later stages don't seed from this field); later
  // stages = previous stage's qualifiers only (stage-to-stage qualification gate), unseeded.
  let pool: { userId: string; seed: number | null }[]
  if (stage.order === 1) {
    const participants = await prisma.tournamentParticipant.findMany({
      where: { tournamentId, checkedIn: true, withdrawn: false },
      select: { userId: true, seed: true },
    })
    pool = participants
  } else {
    const previous = await prisma.tournamentStage.findUnique({ where: { tournamentId_order: { tournamentId, order: stage.order - 1 } } })
    pool = (previous?.qualifiedUserIds ?? []).map((userId) => ({ userId, seed: null }))
  }

  if (stage.format !== 'SWISS') {
    const existing = await prisma.match.count({ where: { stageId } })
    if (existing > 0) throw new StageGenerateError(409, { error: 'bracket_exists' })

    // ROUND_ROBIN — one-shot fixture list (Phase 5 Part C3): the whole circle-method schedule is
    // persisted at once; a second generate is the bracket_exists 409 above.
    if (stage.format === 'ROUND_ROBIN') {
      if (pool.length < 2) {
        throw new StageGenerateError(422, { error: 'not_enough_participants', checkedIn: pool.length })
      }
      const repeats = stage.roundRobinRepeats ?? 1
      const pairings = generateRoundRobinPairings(pool, repeats)
      const perRoundCount = new Map<number, number>()
      const rows: Prisma.MatchCreateManyInput[] = pairings.map((p) => {
        const orderInRound = perRoundCount.get(p.round) ?? 0
        perRoundCount.set(p.round, orderInRound + 1)
        return {
          tournamentId,
          stageId,
          round: p.round,
          swissRound: p.round, // display grouping only (the SwissView render branch reads it)
          bracketOrder: orderInRound,
          player1Id: p.player1Id,
          player2Id: p.player2Id,
          status: 'PENDING',
        }
      })
      await prisma.match.createMany({ data: rows })
      await prisma.stageStanding.createMany({ data: pool.map((p) => ({ stageId, userId: p.userId })) })
      await prisma.tournamentStage.update({ where: { id: stageId }, data: { status: 'ACTIVE' } })
      await assignArenas()
      // [REVIEW-FIX P18-5, documented scope decision] Round Robin creates its ENTIRE schedule
      // (every round) in one shot, all with both players resolved — notifying every future
      // round immediately would mean players getting "your next match begins" for matches
      // days/weeks away, which is spam, not a useful signal. Deliberately scoped to round 1
      // only, matching the same "only what's immediately actionable" principle the elimination
      // branch below already applies (it only notifies the rounds generation itself can
      // populate with both players, never rounds further out). Not an oversight.
      const readyMatches = await prisma.match.findMany({ where: { stageId, round: 1 }, select: { id: true } })
      for (const m of readyMatches) await notifyReady(m.id)
      return { status: 201, payload: { created: rows.length } }
    }

    if (stage.format === 'SINGLE_ELIMINATION' && pool.length < 2) {
      throw new StageGenerateError(422, { error: 'not_enough_participants', checkedIn: pool.length })
    }
    if (stage.format === 'DOUBLE_ELIMINATION' && pool.length < 3) {
      throw new StageGenerateError(422, { error: 'not_enough_participants', checkedIn: pool.length })
    }

    const rows: Prisma.MatchCreateManyInput[] = []
    const pushNodes = (nodes: ReturnType<typeof generateSingleEliminationBracket>, side: 'WINNERS' | 'LOSERS' | 'GRAND_FINAL' | null) => {
      for (const n of nodes) {
        rows.push({
          tournamentId,
          stageId,
          round: n.round,
          bracketOrder: n.bracketOrder,
          player1Id: n.player1Id,
          player2Id: n.player2Id,
          winnerId: n.winnerId,
          status: n.status,
          bracketSide: side ?? undefined,
        })
      }
    }

    let wbByes: ReturnType<typeof generateSingleEliminationBracket> = []
    if (stage.format === 'SINGLE_ELIMINATION') {
      const nodes = generateSingleEliminationBracket(pool)
      wbByes = nodes
      pushNodes(nodes, null)
    } else {
      const bracket = generateDoubleEliminationBracket(pool)
      if (!bracket) throw new StageGenerateError(422, { error: 'not_enough_participants', checkedIn: pool.length })
      wbByes = bracket.winners
      pushNodes(bracket.winners, 'WINNERS')
      pushNodes(bracket.losers, 'LOSERS')
      pushNodes([bracket.grandFinal, bracket.grandFinalReset], 'GRAND_FINAL')
    }
    await prisma.match.createMany({ data: rows })
    await prisma.stageStanding.createMany({ data: pool.map((p) => ({ stageId, userId: p.userId })) })

    // WB bye winners advance immediately (same propagation the score route performs later).
    for (const bye of wbByes.filter((n) => n.round === 1 && n.winnerId !== null)) {
      const slot = bye.bracketOrder % 2 === 0 ? 'player1Id' : 'player2Id'
      await prisma.match.updateMany({
        where: { stageId, round: 2, bracketOrder: Math.floor(bye.bracketOrder / 2) },
        data: { [slot]: bye.winnerId },
      })
    }
    await prisma.tournamentStage.update({ where: { id: stageId }, data: { status: 'ACTIVE' } })
    await assignArenas()
    // Round 1, PLUS round 2 — [REVIEW-FIX P18-2] the bye-advancement loop just above can leave
    // a round-2 match with BOTH players resolved already (two byes feeding the same next-round
    // match — lib/bracket.ts places byes contiguously at orders 0..byes-1, and orders 2k/2k+1
    // both feed round-2 match k), which was previously never notified at all. Later rounds
    // beyond round 2 still can't have both players yet at generation time, so this stays bounded
    // to exactly the rounds generation itself can populate.
    const readyMatches = await prisma.match.findMany({ where: { stageId, round: { in: [1, 2] } }, select: { id: true } })
    for (const m of readyMatches) await notifyReady(m.id)
    return { status: 201, payload: { created: rows.length } }
  }

  // ── SWISS ──────────────────────────────────────────────────────────────────────────────
  if (stage.swissRounds === null || stage.swissRoundsDone >= stage.swissRounds) {
    throw new StageGenerateError(409, { error: 'swiss_complete' })
  }
  // The rule: the stage's current round (the last PAIRED round, numbered swissRoundsDone) must be
  // fully COMPLETED before the next one can be paired.
  const current = stage.swissRoundsDone
  const lastPairedIncomplete = stage.matches.some((m) => m.swissRound === current && m.status !== 'COMPLETED')
  if (lastPairedIncomplete) throw new StageGenerateError(409, { error: 'round_incomplete' })

  // First pairing seeds the stage standings from the pool; later rounds read them (minus anyone
  // eliminated or withdrawn since).
  if ((await prisma.stageStanding.count({ where: { stageId } })) === 0) {
    await prisma.stageStanding.createMany({ data: pool.map((p) => ({ stageId, userId: p.userId })) })
  }
  const withdrawn = await prisma.tournamentParticipant.findMany({
    where: { tournamentId, withdrawn: true },
    select: { userId: true },
  })
  const withdrawnIds = new Set(withdrawn.map((w) => w.userId))
  // Phase 15 — seed tiebreak: read from the original TournamentParticipant rows (not just this
  // stage's pool var) since this pairing call runs for every round of the stage, not only the
  // first; see lib/swiss.ts's own comment on why seed only actually decides anything while
  // every standing still ties at wins=0/buchholz=0 (in practice: round 1).
  const seededParticipants = await prisma.tournamentParticipant.findMany({
    where: { tournamentId },
    select: { userId: true, seed: true },
  })
  const seedByUserId = new Map(seededParticipants.map((p) => [p.userId, p.seed]))
  let standings = await prisma.stageStanding.findMany({
    where: { stageId, eliminated: false, userId: { notIn: [...withdrawnIds] } },
  })
  if (standings.length < 2) throw new StageGenerateError(422, { error: 'not_enough_participants' })

  // Buchholz is "at time of pairing" — recompute and persist it so the standings table the
  // organizer sees matches what the pairing used.
  const bh = computeBuchholz(standings as SwissPlayer[])
  for (const [userId, value] of bh) {
    await prisma.stageStanding.updateMany({ where: { stageId, userId }, data: { buchholz: value } })
  }
  standings = standings.map((s) => ({ ...s, buchholz: bh.get(s.userId) ?? 0 }))

  const seededStandings: SwissPlayer[] = standings.map((s) => ({ ...s, seed: seedByUserId.get(s.userId) ?? null }))
  const { pairings } = pairSwissRound(seededStandings)
  const nextRound = current + 1
  for (const p of pairings) {
    if (p.player2Id === null) {
      // Bye: persisted COMPLETED with the automatic win (uniform with elimination byes).
      await prisma.match.create({
        data: {
          tournamentId,
          stageId,
          round: 0,
          swissRound: nextRound,
          player1Id: p.player1Id,
          player2Id: null,
          winnerId: p.player1Id,
          status: 'COMPLETED',
        },
      })
      await prisma.stageStanding.updateMany({
        where: { stageId, userId: p.player1Id },
        data: { wins: { increment: 1 }, byes: { increment: 1 } },
      })
    } else {
      const created = await prisma.match.create({
        data: { tournamentId, stageId, round: 0, swissRound: nextRound, player1Id: p.player1Id, player2Id: p.player2Id, status: 'PENDING' },
      })
      await notifyReady(created.id)
    }
  }
  await prisma.tournamentStage.update({ where: { id: stageId }, data: { swissRoundsDone: nextRound, status: 'ACTIVE' } })
  await assignArenas()
  return { status: 201, payload: { created: pairings.length, round: nextRound } }
}

async function isAdmin(userId: string): Promise<boolean> {
  const caller = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  return caller?.role === 'ADMIN'
}
