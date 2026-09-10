// app/api/tournaments/[id]/stages/[stageId]/generate/route.ts
// Phase 5 Part C2 — "Bracket generieren / Runde pairen" for ONE stage. AUTHZ RULE (standing
// Global-Constraints requirement; negative test in tests/integration/stage-authz.test.ts): only
// the tournament's creator (createdById) or an ADMIN may generate; anyone else gets 403.
//
// Format dispatch:
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
// PARTICIPANT POOL: stage order === 1 reads all checked-in, non-withdrawn TournamentParticipants
// (Phase 5 Part C behavior); any later stage reads the previous stage's qualifiedUserIds, which
// the stage-complete route populated — this is what gates stage-to-stage qualification.
//
// Phase 7 — ARENA MANAGEMENT: the organizer may pass `arenaCount` (integer 1..64, anything else
// is ignored) in the JSON body. It persists on the tournament (Tournament.arenaCount — the venue
// has one arena pool across all its stages, not one per stage) and, after this stage's matches
// are created, lib/arenaAssign.ts's assignArenasAtGeneration hands out arenaNumber 1..arenaCount
// per round group. If the body omits arenaCount, the tournament's stored value is used, so a
// stage created via POST .../stages with arenaCount keeps it without repeating it here.
import { requireUser, getCallerRole } from '@/lib/guards'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { assignArenasAtGeneration, parseArenaCount } from '@/lib/arenaAssign'
import { generateSingleEliminationBracket } from '@/lib/bracket'
import { generateDoubleEliminationBracket } from '@/lib/doubleElimination'
import { pairSwissRound, computeBuchholz, type SwissPlayer } from '@/lib/swiss'
import { generateRoundRobinPairings } from '@/lib/roundRobin'
import { notifyMatchReady } from '@/lib/notify'

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
import type { Prisma } from '@prisma/client'

type Ctx = { params: Promise<{ id: string; stageId: string }> }

export async function POST(req: Request, { params }: Ctx) {
  const gate = await requireUser()
  if ('error' in gate) return gate.error
  const userId = gate.userId
  // [REVIEW-FIX: backend-security #37] THE expensive one: transactional bracket generation.
  // A bracket is generated once per stage — 15/min/user cannot hinder any real workflow but
  // caps how hard a compromised organizer session can hammer the DB.
  const { allowed } = await rateLimit(`tournament:generate:${userId}`, 15, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })
  const { id, stageId } = await params

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    // no/invalid body is fine — arenaCount is optional
  }

  const stage = await prisma.tournamentStage.findUnique({
    where: { id: stageId },
    include: {
      matches: { select: { id: true, round: true, bracketOrder: true, status: true, swissRound: true } },
      tournament: { select: { createdById: true, arenaCount: true } },
    },
  })
  if (!stage || stage.tournamentId !== id) return Response.json({ error: 'not_found' }, { status: 404 })
  const callerRole = await getCallerRole(userId)
  if (stage.tournament.createdById !== userId && callerRole !== 'ADMIN') {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  if (stage.status === 'COMPLETED') return Response.json({ error: 'stage_completed' }, { status: 409 })

  // Phase 7 — a valid body value overrides/persists; otherwise the stored tournament value applies.
  const bodyArenaCount = parseArenaCount(body.arenaCount)
  if (bodyArenaCount !== null) {
    await prisma.tournament.update({ where: { id }, data: { arenaCount: bodyArenaCount } })
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
      where: { tournamentId: id, checkedIn: true, withdrawn: false },
      select: { userId: true, seed: true },
    })
    pool = participants
  } else {
    const previous = await prisma.tournamentStage.findUnique({ where: { tournamentId_order: { tournamentId: id, order: stage.order - 1 } } })
    pool = (previous?.qualifiedUserIds ?? []).map((userId) => ({ userId, seed: null }))
  }

  if (stage.format !== 'SWISS') {
    const existing = await prisma.match.count({ where: { stageId } })
    if (existing > 0) return Response.json({ error: 'bracket_exists' }, { status: 409 })

    // ROUND_ROBIN — one-shot fixture list (Phase 5 Part C3): the whole circle-method schedule is
    // persisted at once; a second generate is the bracket_exists 409 above.
    if (stage.format === 'ROUND_ROBIN') {
      if (pool.length < 2) {
        return Response.json({ error: 'not_enough_participants', checkedIn: pool.length }, { status: 422 })
      }
      const repeats = stage.roundRobinRepeats ?? 1
      const pairings = generateRoundRobinPairings(pool, repeats)
      const perRoundCount = new Map<number, number>()
      const rows: Prisma.MatchCreateManyInput[] = pairings.map((p) => {
        const orderInRound = perRoundCount.get(p.round) ?? 0
        perRoundCount.set(p.round, orderInRound + 1)
        return {
          tournamentId: id,
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
      return Response.json({ created: rows.length }, { status: 201 })
    }

    if (stage.format === 'SINGLE_ELIMINATION' && pool.length < 2) {
      return Response.json({ error: 'not_enough_participants', checkedIn: pool.length }, { status: 422 })
    }
    if (stage.format === 'DOUBLE_ELIMINATION' && pool.length < 3) {
      return Response.json({ error: 'not_enough_participants', checkedIn: pool.length }, { status: 422 })
    }

    const rows: Prisma.MatchCreateManyInput[] = []
    const pushNodes = (nodes: ReturnType<typeof generateSingleEliminationBracket>, side: 'WINNERS' | 'LOSERS' | 'GRAND_FINAL' | null) => {
      for (const n of nodes) {
        rows.push({
          tournamentId: id,
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
      if (!bracket) return Response.json({ error: 'not_enough_participants', checkedIn: pool.length }, { status: 422 })
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
    return Response.json({ created: rows.length }, { status: 201 })
  }

  // ── SWISS ──────────────────────────────────────────────────────────────────────────────
  if (stage.swissRounds === null || stage.swissRoundsDone >= stage.swissRounds) {
    return Response.json({ error: 'swiss_complete' }, { status: 409 })
  }
  // The rule: the stage's current round (the last PAIRED round, numbered swissRoundsDone) must be
  // fully COMPLETED before the next one can be paired.
  const current = stage.swissRoundsDone
  const lastPairedIncomplete = stage.matches.some((m) => m.swissRound === current && m.status !== 'COMPLETED')
  if (lastPairedIncomplete) return Response.json({ error: 'round_incomplete' }, { status: 409 })

  // First pairing seeds the stage standings from the pool; later rounds read them (minus anyone
  // eliminated or withdrawn since).
  if ((await prisma.stageStanding.count({ where: { stageId } })) === 0) {
    await prisma.stageStanding.createMany({ data: pool.map((p) => ({ stageId, userId: p.userId })) })
  }
  const withdrawn = await prisma.tournamentParticipant.findMany({
    where: { tournamentId: id, withdrawn: true },
    select: { userId: true },
  })
  const withdrawnIds = new Set(withdrawn.map((w) => w.userId))
  // Phase 15 — seed tiebreak: read from the original TournamentParticipant rows (not just this
  // stage's pool var) since this pairing call runs for every round of the stage, not only the
  // first; see lib/swiss.ts's own comment on why seed only actually decides anything while
  // every standing still ties at wins=0/buchholz=0 (in practice: round 1).
  const seededParticipants = await prisma.tournamentParticipant.findMany({
    where: { tournamentId: id },
    select: { userId: true, seed: true },
  })
  const seedByUserId = new Map(seededParticipants.map((p) => [p.userId, p.seed]))
  let standings = await prisma.stageStanding.findMany({
    where: { stageId, eliminated: false, userId: { notIn: [...withdrawnIds] } },
  })
  if (standings.length < 2) return Response.json({ error: 'not_enough_participants' }, { status: 422 })

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
          tournamentId: id,
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
        data: { tournamentId: id, stageId, round: 0, swissRound: nextRound, player1Id: p.player1Id, player2Id: p.player2Id, status: 'PENDING' },
      })
      await notifyReady(created.id)
    }
  }
  await prisma.tournamentStage.update({ where: { id: stageId }, data: { swissRoundsDone: nextRound, status: 'ACTIVE' } })
  await assignArenas()
  return Response.json({ created: pairings.length, round: nextRound }, { status: 201 })
}
