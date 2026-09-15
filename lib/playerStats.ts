// lib/playerStats.ts (issue #199 — Rangliste "Erweitertes Konzept")
// Scope-agnostic per-player stat aggregation: matches played, wins/losses, rounds played,
// tournaments participated, best/average placement. Works for ANY date scope (a season's
// [startsAt, endsAt) window, a calendar year, or unbounded "all-time") because — unlike
// Elo, which is inherently path-dependent and can only ever be read from the running
// PlayerRating ladder for the season it accrued in — these are plain counts derivable by
// filtering Match/TournamentParticipant rows on their tournament's startDate. This is exactly
// the distinction the issue's own "Erweitertes Konzept" comment draws: Season-scope Elo stays
// on PlayerRating; everything else can extend to Year/All-time because it's just counting.
import { prisma } from '@/lib/db'

export interface DateScope {
  /** Inclusive lower bound, or null for unbounded. */
  from: Date | null
  /** Exclusive upper bound, or null for unbounded. */
  to: Date | null
}

export const ALL_TIME_SCOPE: DateScope = { from: null, to: null }

export function yearScope(year: number): DateScope {
  return { from: new Date(Date.UTC(year, 0, 1)), to: new Date(Date.UTC(year + 1, 0, 1)) }
}

export interface PlayerStatRow {
  userId: string
  matchesPlayed: number
  wins: number
  losses: number
  roundsPlayed: number
  tournamentsPlayed: number
  bestPlacement: number | null
  avgPlacement: number | null
}

function emptyRow(userId: string): PlayerStatRow {
  return { userId, matchesPlayed: 0, wins: 0, losses: 0, roundsPlayed: 0, tournamentsPlayed: 0, bestPlacement: null, avgPlacement: null }
}

export interface PlayerStatMatchRow {
  player1Id: string
  player2Id: string
  winnerId: string | null
  scorePlayer1: number
  scorePlayer2: number
}

export interface PlayerStatParticipantRow {
  userId: string
  placement: number | null
}

/**
 * Pure aggregation over already-fetched rows — kept separate from the DB fetch below so it is
 * unit-testable without mocking Prisma (same split as lib/teams.ts's teamMatchRecord vs.
 * lib/teamStats.ts's getTeamStats).
 */
export function aggregatePlayerStats(matches: PlayerStatMatchRow[], participants: PlayerStatParticipantRow[]): Map<string, PlayerStatRow> {
  const stats = new Map<string, PlayerStatRow>()
  const row = (userId: string) => stats.get(userId) ?? (stats.set(userId, emptyRow(userId)), stats.get(userId)!)

  for (const m of matches) {
    const p1 = row(m.player1Id)
    const p2 = row(m.player2Id)
    p1.matchesPlayed++
    p2.matchesPlayed++
    const rounds = m.scorePlayer1 + m.scorePlayer2
    p1.roundsPlayed += rounds
    p2.roundsPlayed += rounds
    if (m.winnerId === m.player1Id) {
      p1.wins++
      p2.losses++
    } else if (m.winnerId === m.player2Id) {
      p2.wins++
      p1.losses++
    }
  }

  const placements = new Map<string, number[]>()
  for (const p of participants) {
    row(p.userId).tournamentsPlayed++
    if (p.placement !== null) {
      const list = placements.get(p.userId) ?? []
      list.push(p.placement)
      placements.set(p.userId, list)
    }
  }
  for (const [userId, list] of placements) {
    const r = row(userId)
    r.bestPlacement = Math.min(...list)
    r.avgPlacement = Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 10) / 10
  }

  return stats
}

/**
 * Aggregates every COMPLETED solo match and every non-withdrawn tournament participation within
 * `scope` into one row per player. Fetches the whole scope's rows and aggregates in memory —
 * fine at this platform's realistic match volume (a DACH community platform, not a global
 * ladder); a materialized aggregate table is not worth the complexity until that stops being true.
 */
export async function computePlayerStats(scope: DateScope): Promise<Map<string, PlayerStatRow>> {
  const tournamentWhere = scope.from || scope.to
    ? { startDate: { ...(scope.from ? { gte: scope.from } : {}), ...(scope.to ? { lt: scope.to } : {}) } }
    : {}

  const [matches, participants] = await Promise.all([
    prisma.match.findMany({
      where: { status: 'COMPLETED', player1Id: { not: null }, player2Id: { not: null }, tournament: tournamentWhere },
      select: { player1Id: true, player2Id: true, winnerId: true, scorePlayer1: true, scorePlayer2: true },
    }),
    prisma.tournamentParticipant.findMany({
      where: { withdrawn: false, tournament: tournamentWhere },
      select: { userId: true, placement: true },
    }),
  ])

  return aggregatePlayerStats(
    matches.map((m) => ({ ...m, player1Id: m.player1Id!, player2Id: m.player2Id! })),
    participants,
  )
}

/** Distinct calendar years (UTC) that have at least one tournament with a start date — for the
 *  Year-scope selector. Newest first. */
export async function tournamentYears(): Promise<number[]> {
  const rows = await prisma.tournament.findMany({ select: { startDate: true } })
  const years = new Set(rows.map((r) => r.startDate.getUTCFullYear()))
  return [...years].sort((a, b) => b - a)
}
