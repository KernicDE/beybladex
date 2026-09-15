// lib/teamStats.ts (issue #198)
// Public team statistics + tournament history — the DB-facing half of lib/teams.ts's pure
// teamMatchRecord aggregation. Reads only COMPLETED TeamMatch rows the team's own
// TeamTournamentEntry rows participate in (either side), so a team's public record only ever
// reflects finished encounters, never in-progress or pending ones.
import { prisma } from '@/lib/db'
import { teamMatchRecord, type TeamRecord } from '@/lib/teams'

export interface TeamTournamentHistoryRow {
  tournamentId: string
  title: string
  startDate: Date
  result: 'win' | 'loss' | 'draw' | 'in_progress'
}

export interface TeamStats {
  record: TeamRecord
  history: TeamTournamentHistoryRow[]
}

/** Public stats for one team, keyed by its id (not slug — callers already resolved the team). */
export async function getTeamStats(teamId: string): Promise<TeamStats> {
  const entries = await prisma.teamTournamentEntry.findMany({
    where: { teamId },
    select: {
      id: true,
      tournamentId: true,
      tournament: { select: { title: true, startDate: true } },
    },
  })
  if (entries.length === 0) return { record: { played: 0, wins: 0, losses: 0, draws: 0 }, history: [] }

  const entryIds = new Set(entries.map((e) => e.id))
  const entryById = new Map(entries.map((e) => [e.id, e]))

  const matches = await prisma.teamMatch.findMany({
    where: {
      OR: [{ team1EntryId: { in: [...entryIds] } }, { team2EntryId: { in: [...entryIds] } }],
    },
    select: { tournamentId: true, team1EntryId: true, team2EntryId: true, status: true, winnerEntryId: true },
  })

  const record = teamMatchRecord(
    matches.map((m) => ({ status: m.status, winnerEntryId: m.winnerEntryId })),
    entryIds,
  )

  // One history row per tournament the team entered, newest first. Result reflects the
  // team's OWN matches within that tournament only (a team can appear in several
  // tournaments; each gets its own independent record).
  const byTournament = new Map<string, { title: string; startDate: Date; matches: typeof matches }>()
  for (const entry of entries) {
    if (!byTournament.has(entry.tournamentId)) {
      byTournament.set(entry.tournamentId, { title: entry.tournament.title, startDate: entry.tournament.startDate, matches: [] })
    }
  }
  for (const m of matches) {
    const bucket = byTournament.get(m.tournamentId)
    if (bucket) bucket.matches.push(m)
  }

  const history: TeamTournamentHistoryRow[] = [...byTournament.entries()]
    .map(([tournamentId, { title, startDate, matches: rows }]) => {
      const own = rows.filter((r) => (r.team1EntryId && entryById.has(r.team1EntryId)) || (r.team2EntryId && entryById.has(r.team2EntryId)))
      const { wins, losses, played } = teamMatchRecord(own.map((r) => ({ status: r.status, winnerEntryId: r.winnerEntryId })), entryIds)
      const result: TeamTournamentHistoryRow['result'] =
        played === 0 ? 'in_progress' : wins > losses ? 'win' : losses > wins ? 'loss' : 'draw'
      return { tournamentId, title, startDate, result }
    })
    .sort((a, b) => b.startDate.getTime() - a.startDate.getTime())

  return { record, history }
}
