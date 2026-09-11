// lib/teamStage.ts (RC15, issue #12 — MVP3 3-vs-3 team competition)
// The DB-side TEAM-STAGE flow, mirroring lib/stageGenerate.ts / lib/stageFlow.ts for the
// team-mode aggregate: stage generation over TeamTournamentEntry pools (SINGLE/DOUBLE
// ELIMINATION), sub-game creation (slot i vs slot i), the best-of-3 encounter resolution
// hook the score route calls after a sub-game completes, and double-elimination winner/
// loser propagation + stuck-bye resolution over TeamMatch rows.
//
// SHAPE REUSE (deliberate): the elimination pure libs (lib/bracket.ts's
// generateSingleEliminationBracket / nextSingleEliminationSlot, lib/doubleElimination.ts's
// generateDoubleEliminationBracket / winnerPropagation / loserPropagation / winnersRounds)
// operate on `{ userId, seed? }` / `{ round, bracketOrder }` shapes only — a team ENTRY ID
// flows through them unchanged in place of a userId, so the team bracket is byte-identical
// in shape to the solo bracket for the same competitor count.
//
// v1 SCOPE (documented in the PR): team mode supports the ELIMINATION formats only. The
// standings-ranked formats (SWISS / ROUND_ROBIN) key StageStanding by a User FK — a
// team-keyed standings model is deferred, so generation refuses them with
// 'team_format_unsupported'. Sub-games never use finalsTargetPoints (their round is 0, so
// lib/scoring.ts's winThreshold resolves to targetPoints — a team game is one game of an
// encounter, not the bracket's final).
import { prisma } from '@/lib/db'
import { generateSingleEliminationBracket, nextSingleEliminationSlot, type BracketNode } from '@/lib/bracket'
import { generateDoubleEliminationBracket, winnerPropagation, loserPropagation, winnersRounds } from '@/lib/doubleElimination'
import { slotFeeder } from '@/lib/stageFlow'
import { notifyMatchReady } from '@/lib/notify'
import { encounterState, encounterGamePlayers, type LineupSlot } from '@/lib/teams'
import { StageGenerateError, type GenerateStageResult } from '@/lib/stageGenerate'
import type { Prisma, PrismaClient, TeamMatch } from '@prisma/client'

// Same contract as lib/stageFlow.ts: callers inside a transaction (the score route) pass the
// tx client so encounter completion + bracket propagation commit atomically with the sub-game.
type Db = PrismaClient | Prisma.TransactionClient

type TeamSlot = 'team1EntryId' | 'team2EntryId'

function slotName(slot: 'player1Id' | 'player2Id'): TeamSlot {
  return slot === 'player1Id' ? 'team1EntryId' : 'team2EntryId'
}

async function isAdmin(userId: string): Promise<boolean> {
  const caller = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  return caller?.role === 'ADMIN'
}

/**
 * Create the three slot-vs-slot sub-games for an encounter whose BOTH teams are known.
 * Idempotent: an encounter that already has games is left untouched (the second slot fill of
 * a next-round encounter must not double-create games).
 */
export async function createEncounterGames(
  db: Db,
  teamMatch: Pick<TeamMatch, 'id' | 'tournamentId' | 'stageId' | 'bracketOrder'>,
  team1Slots: LineupSlot[],
  team2Slots: LineupSlot[]
): Promise<void> {
  const existing = await db.match.count({ where: { teamMatchId: teamMatch.id } })
  if (existing > 0) return
  const pairings = encounterGamePlayers(team1Slots, team2Slots)
  // Sub-games carry round 0 deliberately: they are NOT bracket nodes (no slot propagation, no
  // finals threshold, no arena queue) — the bracket lives on the TeamMatch row.
  await db.match.createMany({
    data: pairings.map((p) => ({
      tournamentId: teamMatch.tournamentId,
      stageId: teamMatch.stageId,
      round: 0,
      bracketOrder: teamMatch.bracketOrder,
      player1Id: p.player1Id,
      player2Id: p.player2Id,
      status: 'PENDING' as const,
      teamMatchId: teamMatch.id,
    })),
  })
}

// Fill one TeamMatch slot with an advancing entry; when the fill completes the encounter
// (both teams known), create its sub-games. Best-effort "Dein nächstes Match beginnt" per
// fresh sub-game — a notification hiccup must never fail the slot write (same contract as
// lib/stageFlow.ts's writeSlot).
async function writeTeamSlot(stageId: string, round: number, bracketOrder: number, slot: TeamSlot, entryId: string, db: Db): Promise<void> {
  const { count } = await db.teamMatch.updateMany({
    where: { stageId, round, bracketOrder },
    data: { [slot]: entryId },
  })
  if (count === 0) return
  const teamMatch = await db.teamMatch.findFirst({
    where: { stageId, round, bracketOrder },
    include: {
      team1Entry: { include: { slots: { select: { position: true, userId: true } } } },
      team2Entry: { include: { slots: { select: { position: true, userId: true } } } },
    },
  })
  if (!teamMatch?.team1Entry || !teamMatch.team2Entry) return
  await createEncounterGames(db, teamMatch, teamMatch.team1Entry.slots, teamMatch.team2Entry.slots)
  const games = await db.match.findMany({ where: { teamMatchId: teamMatch.id }, select: { id: true } })
  for (const game of games) {
    try {
      await notifyMatchReady(game.id)
    } catch (err) {
      console.error(`[teamStage] notifyMatchReady(${game.id}) failed:`, err)
    }
  }
}

/**
 * STUCK-BYE RULE (team mirror of lib/stageFlow.ts's resolveStuckByes, same documented
 * decision): a losers-side encounter whose sibling feeder can never deliver a team while it
 * has exactly one live team auto-completes as a bye (status COMPLETED, winnerEntryId = the
 * live team, wins 3-0 — the uniform bye representation) and propagates. Runs to a fixpoint.
 */
async function resolveTeamStuckByes(stageId: string, participantsForMapping: number, db: Db): Promise<void> {
  for (let guard = 0; guard < 64; guard++) {
    const lbMatches = await db.teamMatch.findMany({
      where: { stageId, bracketSide: 'LOSERS', status: { in: ['PENDING', 'IN_PROGRESS'] } },
    })
    let resolved = false
    for (const m of lbMatches) {
      const live = m.team1EntryId !== null && m.team2EntryId === null ? { id: m.team1EntryId, nullSlot: 'team2EntryId' as const }
        : m.team2EntryId !== null && m.team1EntryId === null ? { id: m.team2EntryId, nullSlot: 'team1EntryId' as const }
        : null
      if (!live) continue
      const feeder = slotFeeder(m.round, m.bracketOrder, live.nullSlot === 'team1EntryId' ? 'player1Id' : 'player2Id', participantsForMapping)
      if (!feeder) continue
      const feederMatch = await db.teamMatch.findFirst({
        where: { stageId, round: feeder.round, bracketOrder: feeder.bracketOrder },
      })
      // The slot can still fill while its feeder is open; only a COMPLETED feeder proves it never will.
      if (!feederMatch || feederMatch.status !== 'COMPLETED') continue
      const current = await db.teamMatch.findUnique({ where: { id: m.id } })
      if (!current || current.status === 'COMPLETED') continue
      if (live.nullSlot === 'team1EntryId' ? current.team1EntryId !== null : current.team2EntryId !== null) continue
      await db.teamMatch.update({ where: { id: m.id }, data: { status: 'COMPLETED', winnerEntryId: live.id, winsTeam1: 3, winsTeam2: 0 } })
      await propagateTeamEliminationResult(m, live.id, participantsForMapping, db)
      resolved = true
    }
    if (!resolved) return
  }
}

/**
 * Propagate a freshly COMPLETED team encounter (double-elimination): winner into their next
 * encounter (or the grand final), loser into the losers side / out, grand-final reset wiring
 * (LB champion's first-final win populates the reset encounter and creates its games; a WB
 * champion win deletes the reset row), then the stuck-bye fixpoint. `participantsForMapping`
 * is the stage's slot count (any number with the same nextPow2 yields the identical mapping).
 */
async function propagateTeamEliminationResult(
  teamMatch: Pick<TeamMatch, 'stageId' | 'round' | 'bracketOrder' | 'bracketSide' | 'team1EntryId' | 'team2EntryId'>,
  winnerEntryId: string,
  participantsForMapping: number,
  db: Db
): Promise<void> {
  const loserEntryId = teamMatch.team1EntryId === winnerEntryId ? teamMatch.team2EntryId : teamMatch.team1EntryId

  const wp = winnerPropagation(teamMatch, participantsForMapping)
  if (wp.type === 'slot') await writeTeamSlot(teamMatch.stageId, wp.target.round, wp.target.bracketOrder, slotName(wp.target.slot), winnerEntryId, db)
  else if (wp.type === 'grand-final') {
    const R = winnersRounds(participantsForMapping)
    await writeTeamSlot(teamMatch.stageId, 3 * R - 1, 0, slotName(wp.slot), winnerEntryId, db)
  }

  const lp = loserPropagation(teamMatch, participantsForMapping)
  if (lp.type === 'slot') {
    // Team mode has no StageStanding — a dropped team is tracked purely by bracket placement.
    if (loserEntryId) await writeTeamSlot(teamMatch.stageId, lp.target.round, lp.target.bracketOrder, slotName(lp.target.slot), loserEntryId, db)
  }

  // Grand-final reset wiring (mirror of the solo flow — see lib/stageFlow.ts).
  const R = winnersRounds(participantsForMapping)
  if (teamMatch.round === 3 * R - 1 && teamMatch.bracketOrder === 0) {
    if (winnerEntryId === teamMatch.team2EntryId && loserEntryId) {
      await db.teamMatch.updateMany({
        where: { stageId: teamMatch.stageId, round: teamMatch.round, bracketOrder: 1 },
        data: { team1EntryId: loserEntryId, team2EntryId: winnerEntryId },
      })
      const reset = await db.teamMatch.findFirst({
        where: { stageId: teamMatch.stageId, round: teamMatch.round, bracketOrder: 1 },
        include: {
          team1Entry: { include: { slots: { select: { position: true, userId: true } } } },
          team2Entry: { include: { slots: { select: { position: true, userId: true } } } },
        },
      })
      if (reset?.team1Entry && reset.team2Entry) {
        await createEncounterGames(db, reset, reset.team1Entry.slots, reset.team2Entry.slots)
      }
    } else {
      await db.teamMatch.deleteMany({
        where: { stageId: teamMatch.stageId, round: teamMatch.round, bracketOrder: 1 },
      })
    }
  }

  await resolveTeamStuckByes(teamMatch.stageId, participantsForMapping, db)
}

/**
 * THE SCORE-ROUTE HOOK: a team-mode sub-game just COMPLETED. Recompute the parent encounter
 * from its games (lib/teams.ts's encounterState — first to 2). Still open → persist the
 * running win counts only. Decided → mark the encounter COMPLETED (conditional updateMany:
 * exactly one concurrent resolver propagates) and advance the winning ENTRY through the team
 * bracket. Idempotent: re-running after the claim writes the same values / no-ops.
 */
export async function resolveTeamEncounter(teamMatchId: string, db: Db = prisma): Promise<void> {
  const teamMatch = await db.teamMatch.findUnique({
    where: { id: teamMatchId },
    include: {
      team1Entry: { include: { slots: { select: { position: true, userId: true } } } },
      team2Entry: { include: { slots: { select: { position: true, userId: true } } } },
      games: { select: { id: true, status: true, winnerId: true } },
    },
  })
  if (!teamMatch) return

  const sideOf = (userId: string | null): 1 | 2 | null => {
    if (!userId) return null
    if (teamMatch.team1Entry?.slots.some((s) => s.userId === userId)) return 1
    if (teamMatch.team2Entry?.slots.some((s) => s.userId === userId)) return 2
    return null
  }
  const state = encounterState(
    teamMatch.games.map((g) => ({ status: g.status, winnerSide: g.winnerId ? sideOf(g.winnerId) : null }))
  )

  if (state.status !== 'COMPLETED' || state.winnerSide === null) {
    await db.teamMatch.updateMany({
      where: { id: teamMatchId, status: { not: 'COMPLETED' } },
      data: { winsTeam1: state.winsTeam1, winsTeam2: state.winsTeam2 },
    })
    return
  }

  const winnerEntryId = state.winnerSide === 1 ? teamMatch.team1EntryId : teamMatch.team2EntryId
  if (!winnerEntryId) return
  const claimed = await db.teamMatch.updateMany({
    where: { id: teamMatchId, status: { not: 'COMPLETED' } },
    data: { status: 'COMPLETED', winnerEntryId, winsTeam1: state.winsTeam1, winsTeam2: state.winsTeam2 },
  })
  if (claimed.count === 0) return

  const stageFormat = (await db.tournamentStage.findUnique({ where: { id: teamMatch.stageId }, select: { format: true } }))?.format
  if (stageFormat === 'DOUBLE_ELIMINATION') {
    const rounds = await db.teamMatch.findMany({ where: { stageId: teamMatch.stageId }, select: { round: true } })
    const R = (Math.max(0, ...rounds.map((m) => m.round)) + 1) / 3
    await propagateTeamEliminationResult(teamMatch, winnerEntryId, 2 ** R, db)
  } else {
    const target = nextSingleEliminationSlot(teamMatch)
    await writeTeamSlot(teamMatch.stageId, target.round, target.bracketOrder, slotName(target.slot), winnerEntryId, db)
  }
}

/**
 * TEAM-MODE STAGE GENERATION (the lib/stageGenerate.ts equivalent for team tournaments).
 * Pool = checked-in & non-withdrawn TeamTournamentEntries (stage order 1 carries each
 * entry's seed; later stages read the previous stage's qualifiers, looked up as entries).
 * Every generated encounter with both teams known gets its three sub-games; bye winners
 * advance into their round-2 encounter immediately. No arena assignment in team mode v1
 * (arenas queue solo matches; documented in the PR).
 */
export async function generateTeamStage({ userId, tournamentId, stageId }: { userId: string; tournamentId: string; stageId: string }): Promise<GenerateStageResult> {
  const stage = await prisma.tournamentStage.findUnique({
    where: { id: stageId },
    include: { tournament: { select: { createdById: true } }, teamMatches: { select: { id: true } } },
  })
  if (!stage || stage.tournamentId !== tournamentId) throw new StageGenerateError(404, { error: 'not_found' })
  if (stage.tournament.createdById !== userId && !(await isAdmin(userId))) {
    throw new StageGenerateError(403, { error: 'forbidden' })
  }
  if (stage.status === 'COMPLETED') throw new StageGenerateError(409, { error: 'stage_completed' })
  // v1: standings-ranked formats need a team-keyed standings model (deferred) — refuse loudly
  // instead of generating a silently wrong solo-keyed bracket.
  if (stage.format !== 'SINGLE_ELIMINATION' && stage.format !== 'DOUBLE_ELIMINATION') {
    throw new StageGenerateError(409, { error: 'team_format_unsupported' })
  }
  if (stage.teamMatches.length > 0) throw new StageGenerateError(409, { error: 'bracket_exists' })

  let pool: { entryId: string; seed: number | null }[]
  if (stage.order === 1) {
    const entries = await prisma.teamTournamentEntry.findMany({
      where: { tournamentId, checkedIn: true, withdrawn: false },
      select: { id: true, seed: true },
    })
    pool = entries.map((e) => ({ entryId: e.id, seed: e.seed }))
  } else {
    const previous = await prisma.tournamentStage.findUnique({ where: { tournamentId_order: { tournamentId, order: stage.order - 1 } } })
    const qualified = previous?.qualifiedUserIds ?? []
    const entries = qualified.length
      ? await prisma.teamTournamentEntry.findMany({ where: { tournamentId, id: { in: qualified } }, select: { id: true, seed: true } })
      : []
    pool = entries.map((e) => ({ entryId: e.id, seed: e.seed }))
  }

  // The elimination pure libs take { userId, seed? } competitors — a team ENTRY ID flows
  // through unchanged, so the team bracket shape equals the solo shape exactly.
  const competitors = pool.map((p) => ({ userId: p.entryId, seed: p.seed }))
  const rows: Prisma.TeamMatchCreateManyInput[] = []
  let wbByes: BracketNode[] = []
  if (stage.format === 'SINGLE_ELIMINATION') {
    if (pool.length < 2) throw new StageGenerateError(422, { error: 'not_enough_participants', checkedIn: pool.length })
    const nodes = generateSingleEliminationBracket(competitors)
    wbByes = nodes
    rows.push(...nodes.map((n) => ({
      tournamentId, stageId, round: n.round, bracketOrder: n.bracketOrder,
      team1EntryId: n.player1Id, team2EntryId: n.player2Id, winnerEntryId: n.winnerId, status: n.status,
    })))
  } else {
    if (pool.length < 3) throw new StageGenerateError(422, { error: 'not_enough_participants', checkedIn: pool.length })
    const bracket = generateDoubleEliminationBracket(competitors)
    if (!bracket) throw new StageGenerateError(422, { error: 'not_enough_participants', checkedIn: pool.length })
    wbByes = bracket.winners
    const push = (nodes: BracketNode[], side: 'WINNERS' | 'LOSERS' | 'GRAND_FINAL') =>
      rows.push(...nodes.map((n) => ({
        tournamentId, stageId, round: n.round, bracketOrder: n.bracketOrder,
        team1EntryId: n.player1Id, team2EntryId: n.player2Id, winnerEntryId: n.winnerId, status: n.status,
        bracketSide: side,
      })))
    push(bracket.winners, 'WINNERS')
    push(bracket.losers, 'LOSERS')
    push([bracket.grandFinal, bracket.grandFinalReset], 'GRAND_FINAL')
  }

  await prisma.teamMatch.createMany({ data: rows })
  await prisma.tournamentStage.update({ where: { id: stageId }, data: { status: 'ACTIVE' } })

  // Sub-games for every encounter whose both teams are known at generation time.
  const created = await prisma.teamMatch.findMany({
    where: { stageId, status: 'PENDING', team1EntryId: { not: null }, team2EntryId: { not: null } },
    include: {
      team1Entry: { include: { slots: { select: { position: true, userId: true } } } },
      team2Entry: { include: { slots: { select: { position: true, userId: true } } } },
    },
  })
  for (const tm of created) {
    if (!tm.team1Entry || !tm.team2Entry) continue
    await createEncounterGames(prisma, tm, tm.team1Entry.slots, tm.team2Entry.slots)
  }

  // WB bye winners advance immediately (same propagation the encounter resolver performs later).
  for (const bye of wbByes.filter((n) => n.round === 1 && n.winnerId !== null)) {
    const slot = bye.bracketOrder % 2 === 0 ? 'team1EntryId' : 'team2EntryId'
    await writeTeamSlot(stageId, 2, Math.floor(bye.bracketOrder / 2), slot, bye.winnerId!, prisma)
  }

  // Best-effort "Dein nächstes Match beginnt" for every fresh sub-game.
  const games = await prisma.match.findMany({
    where: { stageId, teamMatchId: { not: null }, status: 'PENDING' },
    select: { id: true },
  })
  for (const game of games) {
    try {
      await notifyMatchReady(game.id)
    } catch (err) {
      console.error(`[teamStage] notifyMatchReady(${game.id}) failed:`, err)
    }
  }

  return { status: 201, payload: { created: rows.length } }
}
