// components/judge/JudgeBracketView.tsx
// Phase 5 Part C — bracket rendering for everyone (players, judges, spectators); Phase 5 Part C2
// — format-aware render path. Elimination formats (single/double) keep the round-column view;
// a SWISS stage renders as a STANDINGS TABLE + current-round pairings list — a bracket graph
// makes no sense for Swiss (plan decision, not an oversight).
// Mobile-first per [REVIEW-FIX: frontend-pwa I5]: on small screens the CURRENT round renders
// expanded and fully, earlier/later rounds collapse into <details> sections below it — not a
// full bracket graph squeezed into phone width. On sm+ screens all rounds render as columns.
import { Badge } from '@/components/ui/Badge'

export type BracketMatch = {
  id: string
  round: number
  bracketOrder: number
  swissRound?: number | null
  player1Id: string | null
  player2Id: string | null
  winnerId: string | null
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED'
}

export type BracketPlayer = { id: string; name: string }

export type SwissStandingRow = { userId: string; name: string; wins: number; losses: number; buchholz: number }

export type BracketFormat = 'SINGLE_ELIMINATION' | 'DOUBLE_ELIMINATION' | 'SWISS'

// Elimination round label. `wbRounds` is the winners-bracket round count R: for double-elimination
// rounds R+1..3R−2 are losers-bracket rounds and 3R−1 is the grand final. For single-elimination
// pass wbRounds = totalRounds. Swiss matches never reach this helper.
export function eliminationRoundLabel(round: number, wbRounds: number): string {
  if (round <= wbRounds) {
    if (round === wbRounds && wbRounds > 1) return 'Finale'
    if (round === wbRounds - 1 && wbRounds > 2) return 'Halbfinale'
    return `Runde ${round}`
  }
  if (round === 3 * wbRounds - 1) return 'Grand Finale'
  return `Verliererrunde ${round - wbRounds}`
}

function MatchCard({ match, nameOf }: { match: BracketMatch; nameOf: (id: string | null) => string }) {
  const row = (playerId: string | null) => {
    const isWinner = match.winnerId !== null && playerId === match.winnerId
    const isByeSlot = playerId === null && match.status === 'COMPLETED'
    return (
      <li
        className={`flex items-center justify-between gap-2 px-3 py-1.5 text-sm ${
          isWinner ? 'font-semibold text-neon-green' : isByeSlot ? 'text-current/40' : ''
        }`}
      >
        <span>{playerId === null ? (match.winnerId !== null && match.player1Id === null && match.player2Id === null ? '—' : 'Offen') : nameOf(playerId)}</span>
        {playerId !== null && match.player2Id === null && match.status === 'COMPLETED' && (
          <Badge tone="neutral">Freilos</Badge>
        )}
      </li>
    )
  }
  return (
    <ol
      className={`divide-y divide-current/10 rounded-lg border bg-white dark:bg-base-dark-alt ${
        match.status === 'IN_PROGRESS'
          ? 'border-x-cyan/60'
          : match.status === 'COMPLETED'
            ? 'border-current/15'
            : 'border-dashed border-current/25'
      }`}
      aria-label={match.status === 'COMPLETED' ? 'Abgeschlossenes Match' : 'Bevorstehendes Match'}
    >
      {row(match.player1Id)}
      {row(match.player2Id)}
    </ol>
  )
}

function SwissView({ matches, players, standings }: { matches: BracketMatch[]; players: BracketPlayer[]; standings: SwissStandingRow[] }) {
  const nameOf = (id: string | null) => (id === null ? 'Offen' : (players.find((p) => p.id === id)?.name ?? 'Unbekannt'))
  const rounds = [...new Set(matches.map((m) => m.swissRound ?? 0))].filter((r) => r > 0).sort((a, b) => a - b)
  const currentRound = rounds.find((r) => matches.some((m) => m.swissRound === r && m.status !== 'COMPLETED')) ?? rounds[rounds.length - 1]
  return (
    <div className="space-y-4">
      {standings.length > 0 && (
        <table className="w-full text-sm">
          <caption className="sr-only">Aktuelle Platzierung</caption>
          <thead>
            <tr className="text-left text-current/60">
              <th scope="col" className="py-1 pr-2 font-medium">#</th>
              <th scope="col" className="py-1 pr-2 font-medium">Spieler</th>
              <th scope="col" className="py-1 pr-2 text-right font-medium">S</th>
              <th scope="col" className="py-1 pr-2 text-right font-medium">N</th>
              <th scope="col" className="py-1 text-right font-medium">Buchholz</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((s, i) => (
              <tr key={s.userId} className="border-t border-current/10">
                <td className="py-1.5 pr-2 text-current/60">{i + 1}</td>
                <td className="py-1.5 pr-2">{s.name}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{s.wins}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{s.losses}</td>
                <td className="py-1.5 text-right tabular-nums">{s.buchholz}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {rounds.length === 0 ? (
        <p className="text-sm text-current/60">Noch keine Runde gepaart — der Organisator startet die Paarung.</p>
      ) : (
        rounds.map((r) => (
          <section key={r} aria-labelledby={`swiss-round-${r}`} className="space-y-2">
            <h3 id={`swiss-round-${r}`} className="text-sm font-semibold text-current/70">
              Runde {r}
              {r === currentRound && <Badge tone="cyan" className="ml-2">Aktuell</Badge>}
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {matches
                .filter((m) => m.swissRound === r)
                .map((m) => (
                  <MatchCard key={m.id} match={m} nameOf={nameOf} />
                ))}
            </div>
          </section>
        ))
      )}
    </div>
  )
}

export function JudgeBracketView({
  matches,
  players,
  format = 'SINGLE_ELIMINATION',
  wbRounds,
  standings = [],
}: {
  matches: BracketMatch[]
  players: BracketPlayer[]
  format?: BracketFormat
  /** Winners-bracket round count R (double-elimination); single-elimination: the total rounds. */
  wbRounds?: number
  standings?: SwissStandingRow[]
}) {
  if (format === 'SWISS') {
    if (matches.length === 0 && standings.length === 0) return null
    return <SwissView matches={matches} players={players} standings={standings} />
  }
  if (matches.length === 0) return null
  const nameOf = (id: string | null) => (id === null ? 'Offen' : (players.find((p) => p.id === id)?.name ?? 'Unbekannt'))
  const totalRounds = Math.max(...matches.map((m) => m.round))
  const R = wbRounds ?? totalRounds
  const rounds = Array.from({ length: totalRounds }, (_, i) => i + 1)
  // Current round: the first (lowest) round that still has an open match — what players and
  // judges care about on a phone during the event.
  const currentRound =
    rounds.find((r) => matches.some((m) => m.round === r && m.status !== 'COMPLETED')) ?? totalRounds

  const renderRound = (round: number) => (
    <section key={round} aria-labelledby={`round-${round}`} className="min-w-56 flex-1 space-y-2">
      <h3 id={`round-${round}`} className="text-sm font-semibold text-current/70">
        {eliminationRoundLabel(round, R)}
        {round === currentRound && <Badge tone="cyan" className="ml-2">Aktuell</Badge>}
      </h3>
      <div className="space-y-2">
        {matches
          .filter((m) => m.round === round)
          .sort((a, b) => a.bracketOrder - b.bracketOrder)
          .map((m) => (
            <MatchCard key={m.id} match={m} nameOf={nameOf} />
          ))}
      </div>
    </section>
  )

  return (
    <div className="space-y-3">
      {/* Mobile: current round expanded, the rest collapsible below it */}
      <div className="space-y-3 sm:hidden">
        {renderRound(currentRound)}
        {rounds
          .filter((r) => r !== currentRound)
          .map((r) => (
            <details key={r} className="group rounded-lg border border-current/15">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-current/70 group-open:rounded-t-lg group-open:border-b group-open:border-current/10">
                {eliminationRoundLabel(r, R)}
              </summary>
              <div className="space-y-2 p-2">{renderRound(r)}</div>
            </details>
          ))}
      </div>
      {/* Desktop: full bracket as columns */}
      <div className="hidden gap-4 overflow-x-auto sm:flex">{rounds.map(renderRound)}</div>
    </div>
  )
}
