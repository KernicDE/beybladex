// lib/meta.ts (Phase 5 Part D — Auto-Meta Engine)
// Win-rate aggregation over COMPLETED Matches, spec §2.E's "Automatische Berechnung von
// Win-Rates … basierend auf Turnier-Ergebnissen".
//
// SPLIT (documented, per the plan's test list): the aggregation itself is a PURE function
// (aggregateWinRates) taking match rows + a build→parts map — no Prisma, no Redis, no clock —
// so tests/unit/meta.test.ts is a genuine unit test over in-memory rows. The exported
// computePartWinRates()/computeBuildWinRates() are thin DB-querying wrappers around it
// (used by the cache's whole-cache-empty fallback and ad-hoc recomputation).
//
// AGGREGATION SCOPE: ALL Match rows with status = 'COMPLETED' and a winnerId, regardless of
// tournament format or stage — a COMPLETED Swiss or Round-Robin match counts exactly the same
// toward Part/Build win rates as a bracket match (every format sets player1BuildId/
// player2BuildId identically at match start). Do NOT add a format filter here.
//
// DENOMINATOR POLICY (binding): a Part/Build needs at least MIN_APPEARANCES decisive match
// appearances DACH-wide before a win rate is displayed. Below that, winRate is null — the
// explicit "Noch nicht genug Daten" marker — instead of a misleadingly precise 1–0 percentage.
// Appearances are DECISIVE appearances (wins + losses): draws are excluded from the
// denominator defensively (Beyblade X matches don't draw under the scoring rules, but a row
// whose winnerId matches neither player — e.g. a hand-corrected DB row — must not poison the
// rate). Matches where a side has no confirmed build (playerNBuildId null) simply don't
// attribute that side.
import { prisma } from '@/lib/db'

export const MIN_APPEARANCES = 10

export interface BuildMetaStats {
  id: string
  appearances: number // decisive appearances (wins + losses); draws excluded
  wins: number
  losses: number
  /** wins / (wins + losses), rounded to 3 decimals; null = below MIN_APPEARANCES ("Noch nicht genug Daten"). */
  winRate: number | null
}

export interface PartMetaStats {
  id: string
  appearances: number // match-appearances of builds using this part (decisive only)
  wins: number
  losses: number
  winRate: number | null
}

/** The match-row shape the pure aggregator needs — satisfied by a Prisma select. */
export interface CompletedMatchRow {
  player1Id: string | null
  player2Id: string | null
  winnerId: string | null
  player1BuildId: string | null
  player2BuildId: string | null
  // Phase 16 item 3 — only meaningful when the confirmed build on that side contains a
  // dualSpin part; undefined/null on legacy rows and non-dual-spin builds alike.
  player1SpinMode?: 'RIGHT' | 'LEFT' | null
  player2SpinMode?: 'RIGHT' | 'LEFT' | null
}

export interface BuildPartsRow {
  id: string
  bladeId: string
  ratchetId: string
  bitId: string
}

export interface WinRateAggregation {
  builds: Map<string, BuildMetaStats>
  parts: Map<string, PartMetaStats>
}

function zeroBuildStats(id: string): BuildMetaStats {
  return { id, appearances: 0, wins: 0, losses: 0, winRate: null }
}

function zeroPartStats(id: string): PartMetaStats {
  return { id, appearances: 0, wins: 0, losses: 0, winRate: null }
}

function finalize<T extends { appearances: number; wins: number; losses: number; winRate: number | null }>(
  stats: T,
): T {
  stats.appearances = stats.wins + stats.losses
  stats.winRate = stats.appearances >= MIN_APPEARANCES ? Math.round((stats.wins / stats.appearances) * 1000) / 1000 : null
  return stats
}

/**
 * Pure win-rate aggregation over completed match rows.
 *
 * @param matches   Completed match rows (status/winner filtering is the CALLER's job; this
 *                  function still defensively skips rows whose winnerId matches neither
 *                  player — the draw case — and rows with null build ids on a side).
 * @param buildParts  Map of buildId → its three part ids, for every build that can appear in
 *                  `matches` (and every build to be seeded with a zero entry).
 * @param allPartIds  Optional catalog-wide part ids: every one is seeded with a zero-stats
 *                  entry so full-catalog surfaces (the /meta page, computePartWinRates) can
 *                  distinguish "no data" from "not in result". Omit in unit tests.
 * @param dualSpinPartIds  Phase 16 item 3 — part ids that are dual-spin. For these (and ONLY
 *                  these — non-dual-spin parts are completely unaffected, per the acceptance
 *                  criterion), an ADDITIONAL composite entry keyed `${partId}:${mode}` is
 *                  populated alongside the normal bare-partId entry, so a RIGHT-mode and
 *                  LEFT-mode use of the same physical part never get silently averaged
 *                  together into one misleading number. The bare-partId entry keeps
 *                  aggregating across both modes too (an "overall regardless of mode" figure
 *                  other, mode-agnostic consumers — the build/search pages — keep reading
 *                  unchanged); the /meta leaderboard is what actually renders the composite,
 *                  never-conflated per-mode entries for these parts (see app/meta/page.tsx).
 */
export function aggregateWinRates(
  matches: CompletedMatchRow[],
  buildParts: Map<string, BuildPartsRow>,
  allPartIds?: string[],
  dualSpinPartIds: Set<string> = new Set(),
): WinRateAggregation {
  const builds = new Map<string, BuildMetaStats>()
  const parts = new Map<string, PartMetaStats>()

  for (const id of buildParts.keys()) builds.set(id, zeroBuildStats(id))
  for (const id of allPartIds ?? []) {
    parts.set(id, zeroPartStats(id))
    if (dualSpinPartIds.has(id)) {
      parts.set(`${id}:RIGHT`, zeroPartStats(`${id}:RIGHT`))
      parts.set(`${id}:LEFT`, zeroPartStats(`${id}:LEFT`))
    }
  }

  const partIdsOf = (row: BuildPartsRow): string[] => [row.bladeId, row.ratchetId, row.bitId]

  const bump = (key: string, won: boolean) => {
    const p = parts.get(key) ?? zeroPartStats(key)
    if (won) p.wins += 1
    else p.losses += 1
    parts.set(key, p)
  }

  for (const m of matches) {
    // Defensive draw/no-decision handling: winner must be one of the two players.
    const side1Won = m.winnerId !== null && m.winnerId === m.player1Id
    const side2Won = m.winnerId !== null && m.winnerId === m.player2Id
    if (!side1Won && !side2Won) continue

    const sides: Array<{ buildId: string | null; won: boolean; spinMode: 'RIGHT' | 'LEFT' | null | undefined }> = [
      { buildId: m.player1BuildId, won: side1Won, spinMode: m.player1SpinMode },
      { buildId: m.player2BuildId, won: side2Won, spinMode: m.player2SpinMode },
    ]
    for (const side of sides) {
      if (!side.buildId) continue // no confirmed build on this side — nothing to attribute
      const bp = buildParts.get(side.buildId)
      if (!bp) continue // unknown build — caller didn't supply its parts
      const b = builds.get(side.buildId) ?? zeroBuildStats(side.buildId)
      if (side.won) b.wins += 1
      else b.losses += 1
      builds.set(side.buildId, b)
      for (const partId of partIdsOf(bp)) {
        bump(partId, side.won) // bare key: always aggregated, mode-agnostic (unchanged behavior)
        // Composite key: ONLY for dual-spin parts with a KNOWN mode on this side — a legacy
        // row or an unset mode simply doesn't contribute to either per-mode bucket, rather
        // than guessing.
        if (dualSpinPartIds.has(partId) && side.spinMode) {
          bump(`${partId}:${side.spinMode}`, side.won)
        }
      }
    }
  }

  for (const stats of builds.values()) finalize(stats)
  for (const stats of parts.values()) finalize(stats)
  return { builds, parts }
}

const BUILD_PARTS_SELECT = { id: true, bladeId: true, ratchetId: true, bitId: true } as const

const MATCH_ROW_SELECT = {
  player1Id: true,
  player2Id: true,
  winnerId: true,
  player1BuildId: true,
  player2BuildId: true,
  player1SpinMode: true,
  player2SpinMode: true,
} as const

async function loadBuildPartsMap(buildIds?: string[]): Promise<Map<string, BuildPartsRow>> {
  const rows = await prisma.build.findMany({
    where: buildIds ? { id: { in: buildIds } } : {},
    select: BUILD_PARTS_SELECT,
  })
  return new Map(rows.map((r) => [r.id, r]))
}

/** Full-table recompute wrapper (used by the cache fallback). Returns one entry per Build. */
export async function computeBuildWinRates(): Promise<BuildMetaStats[]> {
  const buildParts = await loadBuildPartsMap()
  const matches = await prisma.match.findMany({
    where: { status: 'COMPLETED', winnerId: { not: null } },
    select: MATCH_ROW_SELECT,
  })
  const { builds } = aggregateWinRates(matches, buildParts)
  return [...builds.values()]
}

/** Full-table recompute wrapper. Returns one entry per catalog Part (zero entries included),
 *  plus a `${partId}:RIGHT`/`${partId}:LEFT` pair for every dual-spin part (Phase 16 item 3). */
export async function computePartWinRates(): Promise<PartMetaStats[]> {
  const buildParts = await loadBuildPartsMap()
  const allParts = await prisma.part.findMany({ select: { id: true, dualSpin: true } })
  const matches = await prisma.match.findMany({
    where: { status: 'COMPLETED', winnerId: { not: null } },
    select: MATCH_ROW_SELECT,
  })
  const dualSpinPartIds = new Set(allParts.filter((p) => p.dualSpin).map((p) => p.id))
  const { parts } = aggregateWinRates(matches, buildParts, allParts.map((p) => p.id), dualSpinPartIds)
  return [...parts.values()]
}
