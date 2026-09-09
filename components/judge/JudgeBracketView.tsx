// components/judge/JudgeBracketView.tsx
// Phase 5 Part C — bracket rendering for everyone (players, judges, spectators).
// Mobile-first per [REVIEW-FIX: frontend-pwa I5]: on small screens the CURRENT round renders
// expanded and fully, earlier/later rounds collapse into <details> sections below it — not a
// full bracket graph squeezed into phone width. On sm+ screens all rounds render as columns.
import { Badge } from '@/components/ui/Badge'

export type BracketMatch = {
  id: string
  round: number
  bracketOrder: number
  player1Id: string | null
  player2Id: string | null
  winnerId: string | null
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED'
}

export type BracketPlayer = { id: string; name: string }

function roundLabel(round: number, totalRounds: number): string {
  if (round === totalRounds && totalRounds > 1) return 'Finale'
  if (round === totalRounds - 1 && totalRounds > 2) return 'Halbfinale'
  return `Runde ${round}`
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

export function JudgeBracketView({ matches, players }: { matches: BracketMatch[]; players: BracketPlayer[] }) {
  if (matches.length === 0) return null
  const nameOf = (id: string | null) => (id === null ? 'Offen' : (players.find((p) => p.id === id)?.name ?? 'Unbekannt'))
  const totalRounds = Math.max(...matches.map((m) => m.round))
  const rounds = Array.from({ length: totalRounds }, (_, i) => i + 1)
  // Current round: the first (lowest) round that still has an open match — what players and
  // judges care about on a phone during the event.
  const currentRound =
    rounds.find((r) => matches.some((m) => m.round === r && m.status !== 'COMPLETED')) ?? totalRounds

  const renderRound = (round: number) => (
    <section key={round} aria-labelledby={`round-${round}`} className="min-w-56 flex-1 space-y-2">
      <h3 id={`round-${round}`} className="text-sm font-semibold text-current/70">
        {roundLabel(round, totalRounds)}
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
                {roundLabel(r, totalRounds)}
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
