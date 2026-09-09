// components/beyblade/WinRateBadge.tsx (Phase 5 Part D)
// Compact Auto-Meta win-rate badge: "62% (34)" = win rate + decisive appearance count, or
// "Noch nicht genug Daten" below the MIN_APPEARANCES threshold (winRate === null — the
// explicit not-enough-data marker from lib/meta.ts). Purely presentational, server-safe.
import { Badge } from '@/components/ui/Badge'

export interface WinRateStats {
  appearances: number
  winRate: number | null
}

export function WinRateBadge({ stats }: { stats: WinRateStats | null }) {
  if (!stats || stats.winRate === null) {
    return <Badge tone="neutral">Noch nicht genug Daten</Badge>
  }
  return (
    <Badge tone="green" title={`${stats.appearances} ausgewertete Matches (Siege + Niederlagen)`}>
      {Math.round(stats.winRate * 100)}% ({stats.appearances})
    </Badge>
  )
}
