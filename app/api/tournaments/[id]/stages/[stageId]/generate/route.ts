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
//
// PARTICIPANT POOL: stage order === 1 reads all checked-in, non-withdrawn TournamentParticipants
// (Phase 5 Part C behavior); any later stage reads the previous stage's qualifiedUserIds, which
// the stage-complete route populated — this is what gates stage-to-stage qualification.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { generateSingleEliminationBracket } from '@/lib/bracket'
import { generateDoubleEliminationBracket } from '@/lib/doubleElimination'
import { pairSwissRound, computeBuchholz, type SwissPlayer } from '@/lib/swiss'
import type { Prisma } from '@prisma/client'

type Ctx = { params: Promise<{ id: string; stageId: string }> }

export async function POST(_req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  const { id, stageId } = await params

  const stage = await prisma.tournamentStage.findUnique({
    where: { id: stageId },
    include: {
      matches: { select: { id: true, round: true, bracketOrder: true, status: true, swissRound: true } },
      tournament: { select: { createdById: true } },
    },
  })
  if (!stage || stage.tournamentId !== id) return Response.json({ error: 'not_found' }, { status: 404 })
  const caller = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
  if (stage.tournament.createdById !== session.user.id && caller?.role !== 'ADMIN') {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }
  if (stage.status === 'COMPLETED') return Response.json({ error: 'stage_completed' }, { status: 409 })

  // Participant pool: first stage = checked-in & present; later stages = previous stage's
  // qualifiers only (stage-to-stage qualification gate).
  let pool: string[]
  if (stage.order === 1) {
    const participants = await prisma.tournamentParticipant.findMany({
      where: { tournamentId: id, checkedIn: true, withdrawn: false },
      select: { userId: true },
    })
    pool = participants.map((p) => p.userId)
  } else {
    const previous = await prisma.tournamentStage.findUnique({ where: { tournamentId_order: { tournamentId: id, order: stage.order - 1 } } })
    pool = previous?.qualifiedUserIds ?? []
  }

  if (stage.format !== 'SWISS') {
    const existing = await prisma.match.count({ where: { stageId } })
    if (existing > 0) return Response.json({ error: 'bracket_exists' }, { status: 409 })
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
      const nodes = generateSingleEliminationBracket(pool.map((userId) => ({ userId })))
      wbByes = nodes
      pushNodes(nodes, null)
    } else {
      const bracket = generateDoubleEliminationBracket(pool.map((userId) => ({ userId })))
      if (!bracket) return Response.json({ error: 'not_enough_participants', checkedIn: pool.length }, { status: 422 })
      wbByes = bracket.winners
      pushNodes(bracket.winners, 'WINNERS')
      pushNodes(bracket.losers, 'LOSERS')
      pushNodes([bracket.grandFinal, bracket.grandFinalReset], 'GRAND_FINAL')
    }
    await prisma.match.createMany({ data: rows })
    await prisma.stageStanding.createMany({ data: pool.map((userId) => ({ stageId, userId })) })

    // WB bye winners advance immediately (same propagation the score route performs later).
    for (const bye of wbByes.filter((n) => n.round === 1 && n.winnerId !== null)) {
      const slot = bye.bracketOrder % 2 === 0 ? 'player1Id' : 'player2Id'
      await prisma.match.updateMany({
        where: { stageId, round: 2, bracketOrder: Math.floor(bye.bracketOrder / 2) },
        data: { [slot]: bye.winnerId },
      })
    }
    await prisma.tournamentStage.update({ where: { id: stageId }, data: { status: 'ACTIVE' } })
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
    await prisma.stageStanding.createMany({ data: pool.map((userId) => ({ stageId, userId })) })
  }
  const withdrawn = await prisma.tournamentParticipant.findMany({
    where: { tournamentId: id, withdrawn: true },
    select: { userId: true },
  })
  const withdrawnIds = new Set(withdrawn.map((w) => w.userId))
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

  const { pairings } = pairSwissRound(standings as SwissPlayer[])
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
      await prisma.match.create({
        data: { tournamentId: id, stageId, round: 0, swissRound: nextRound, player1Id: p.player1Id, player2Id: p.player2Id, status: 'PENDING' },
      })
    }
  }
  await prisma.tournamentStage.update({ where: { id: stageId }, data: { swissRoundsDone: nextRound, status: 'ACTIVE' } })
  return Response.json({ created: pairings.length, round: nextRound }, { status: 201 })
}
