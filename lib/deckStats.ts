// lib/deckStats.ts (MVP4/4, #144)
// Deck-Aggregat über die Auto-Meta-Statistiken seiner Builds (Turnier-Statistiken auf der
// Deck-Detailseite). Reines Shaping über getBuildStats-Ergebnisse (BuildMetaStats, lib/meta.ts)
// — keine eigene Query-Logik: ein Batch-getBuildStats(deckBuildIds) liefert die Eingabe.
// Denominator-Policy identisch zu lib/meta.ts: winRate erst ab MIN_APPEARANCES entscheidender
// Matches, sonst null ("Noch nicht genug Daten").
import { MIN_APPEARANCES, type BuildMetaStats } from '@/lib/meta'

/** Summiert die Build-Stats eines Decks zu einem Deck-Gesamtwert. null-Stats zählen als 0. */
export function aggregateDeckStats(stats: ReadonlyArray<BuildMetaStats | null | undefined>): BuildMetaStats {
  let appearances = 0
  let wins = 0
  let losses = 0
  for (const s of stats) {
    if (!s) continue
    appearances += s.appearances
    wins += s.wins
    losses += s.losses
  }
  return {
    id: 'deck',
    appearances,
    wins,
    losses,
    winRate: appearances >= MIN_APPEARANCES ? Math.round((wins / appearances) * 1000) / 1000 : null,
  }
}
