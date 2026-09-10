// lib/metaCache.ts (Phase 5 Part D — Auto-Meta Engine)
// Dirty-set + recompute pattern: completing a match does NOT recompute aggregates inline
// (the plan's explicit performance point — "mark dirty, recompute periodically" over
// "recompute the whole table on every score"). This module owns both halves.
//
// REDIS KEY SCHEME (command connection `redis` only — never `redisSubscriber`, standing
// Global-Constraints topology rule):
//   meta:dirty:builds       — SET of Build ids whose aggregates are stale (SADD on completion)
//   meta:dirty:parts        — SET of Part ids stale (the completing builds' blade/ratchet/bit)
//   meta:build:{buildId}    — JSON BuildMetaStats, NO TTL: the cached value is valid until the
//                             next completion involving that build, and every completion marks
//                             the build dirty again — a TTL would only add staleness windows.
//   meta:part:{partId}      — JSON PartMetaStats, same no-TTL rationale.
//
// ATOMIC POP: the dirty sets are drained with a Lua script (SMEMBERS + DEL in one round trip,
// atomic) so a concurrent score POST's SADD either lands before the DEL (included in this
// pass) or after it (left in a freshly-created set, picked up by the next pass) — never lost.
//
// OPERATIONAL GAP, documented per the plan (same constraint as lib/notificationCleanup.ts):
// this repo has no cron/worker process, so recomputeDirtyMeta() is ONLY ever called when an
// external scheduler hits POST /api/internal/recompute-meta — the same scheduler that already
// hits /api/internal/cleanup-notifications. Wiring it is a deploy-time operational task
// (system crontab or scheduled GitHub Actions workflow with the x-cron-secret header).
//
// DEGRADATION: dirty-marking and cache reads are best-effort — a Redis hiccup during a score
// POST is swallowed there (the score is already persisted; the aggregate just misses this
// match until the next dirty event), and cache reads with Redis down fall back to direct DB
// computation so pages never blank.
import { redis } from '@/lib/redis'
import { prisma } from '@/lib/db'
import { aggregateWinRates, computeBuildWinRates, computePartWinRates } from '@/lib/meta'
import type { BuildMetaStats, PartMetaStats } from '@/lib/meta'

export const DIRTY_BUILDS_KEY = 'meta:dirty:builds'
export const DIRTY_PARTS_KEY = 'meta:dirty:parts'
export const buildCacheKey = (id: string) => `meta:build:${id}`
export const partCacheKey = (id: string) => `meta:part:${id}`

// SMEMBERS + DEL atomically: returns the members and drains the set in one step so nothing
// added concurrently is lost (see module header).
const POP_SCRIPT = `local members = redis.call('SMEMBERS', KEYS[1])
if #members > 0 then redis.call('DEL', KEYS[1]) end
return members`

async function popDirty(key: string): Promise<string[]> {
  try {
    const members = (await redis.eval(POP_SCRIPT, 1, key)) as string[]
    return members
  } catch {
    return [] // Redis down — this pass is a no-op; the dirty set is left intact for next time
  }
}

/** Mark builds (and their parts) dirty after a match completion. Best-effort: never throws. */
export async function markMetaDirty(buildIds: string[], partIds: string[]): Promise<void> {
  if (buildIds.length === 0 && partIds.length === 0) return
  try {
    if (buildIds.length > 0) await redis.sadd(DIRTY_BUILDS_KEY, ...buildIds)
    if (partIds.length > 0) await redis.sadd(DIRTY_PARTS_KEY, ...partIds)
  } catch {
    // Swallowed deliberately: the score is already persisted; a missed dirty mark only delays
    // the aggregate update until the next completion touches this build/part.
  }
}

/**
 * Drain the dirty sets and recompute exactly those ids (not the whole table), writing each
 * result to its Redis cache key. Returns the number of dirty ids processed per kind.
 */
export async function recomputeDirtyMeta(): Promise<{ parts: number; builds: number }> {
  const dirtyBuilds = await popDirty(DIRTY_BUILDS_KEY)
  const dirtyParts = await popDirty(DIRTY_PARTS_KEY)
  if (dirtyBuilds.length === 0 && dirtyParts.length === 0) return { parts: 0, builds: 0 }

  // A dirty part means "every build referencing it is stale": expand parts → builds so one
  // match query covers both kinds. (recompute is per-id, but matches are shared between a
  // build and its three parts — one query for the union is cheaper than one per dirty id.)
  const partBuilds = dirtyParts.length
    ? await prisma.build.findMany({
        where: {
          OR: [{ bladeId: { in: dirtyParts } }, { ratchetId: { in: dirtyParts } }, { bitId: { in: dirtyParts } }],
        },
        select: { id: true, bladeId: true, ratchetId: true, bitId: true },
      })
    : []
  const affectedBuildIds = [...new Set([...dirtyBuilds, ...partBuilds.map((b) => b.id)])]

  const matches = affectedBuildIds.length
    ? await prisma.match.findMany({
        where: {
          status: 'COMPLETED',
          winnerId: { not: null },
          OR: [{ player1BuildId: { in: affectedBuildIds } }, { player2BuildId: { in: affectedBuildIds } }],
        },
        select: {
          player1Id: true,
          player2Id: true,
          winnerId: true,
          player1BuildId: true,
          player2BuildId: true,
          player1SpinMode: true,
          player2SpinMode: true,
        },
      })
    : []

  // The parts map must cover every build appearing in the match rows (for part-level
  // attribution), not just the affected ones — an opponent's build counts as an appearance
  // for ITS parts too only if it's dirty; but aggregation needs the opponent's part ids to
  // attribute the opponent side, and only affected builds' results are written back.
  const matchBuildIds = [
    ...new Set(matches.flatMap((m) => [m.player1BuildId, m.player2BuildId]).filter((v): v is string => Boolean(v))),
  ]
  const buildRows = await prisma.build.findMany({
    where: { id: { in: matchBuildIds } },
    select: { id: true, bladeId: true, ratchetId: true, bitId: true },
  })
  const buildParts = new Map(buildRows.map((r) => [r.id, r]))

  // Phase 16 item 3 — which of the dirty parts are dual-spin, so their composite per-mode
  // cache entries get recomputed alongside the bare-key entry below.
  const dirtyDualSpinParts = dirtyParts.length
    ? (await prisma.part.findMany({ where: { id: { in: dirtyParts }, dualSpin: true }, select: { id: true } })).map((p) => p.id)
    : []
  const agg = aggregateWinRates(matches, buildParts, dirtyParts, new Set(dirtyDualSpinParts))

  const pipeline = redis.pipeline()
  for (const id of dirtyBuilds) {
    pipeline.set(buildCacheKey(id), JSON.stringify(agg.builds.get(id) ?? {
      id,
      appearances: 0,
      wins: 0,
      losses: 0,
      winRate: null,
    } satisfies BuildMetaStats))
  }
  for (const id of dirtyParts) {
    pipeline.set(partCacheKey(id), JSON.stringify(agg.parts.get(id) ?? {
      id,
      appearances: 0,
      wins: 0,
      losses: 0,
      winRate: null,
    } satisfies PartMetaStats))
  }
  // Phase 16 item 3 — the composite per-mode entries for dirty dual-spin parts.
  for (const id of dirtyDualSpinParts) {
    for (const mode of ['RIGHT', 'LEFT'] as const) {
      const key = `${id}:${mode}`
      pipeline.set(partCacheKey(key), JSON.stringify(agg.parts.get(key) ?? {
        id: key,
        appearances: 0,
        wins: 0,
        losses: 0,
        winRate: null,
      } satisfies PartMetaStats))
    }
  }
  try {
    await pipeline.exec()
  } catch {
    // Redis down: results are discarded, dirty sets already drained — a completion will
    // re-mark; pages meanwhile fall back to direct computation (getBuildStats/getPartStats).
  }
  return { parts: dirtyParts.length, builds: dirtyBuilds.length }
}

function parseJson<T>(raw: string | null): T | null {
  if (raw === null) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

async function mgetJson<T>(keys: string[]): Promise<Map<string, T | null>> {
  if (keys.length === 0) return new Map()
  let raws: Array<string | null>
  try {
    raws = await redis.mget(...keys)
  } catch {
    return new Map(keys.map((k) => [k, null]))
  }
  return new Map(keys.map((k, i) => [k, parseJson<T>(raws[i])]))
}

/**
 * Batch-read cached BuildMetaStats for a list of ids (ONE mget, never N round trips).
 * Whole-cache-empty fallback (fresh deploy / Redis down / nothing recomputed yet): computes
 * directly from the DB so pages never render blank. Individual misses stay null — callers
 * display the "Noch nicht genug Daten" state, which is accurate for a build with no
 * decisive completed matches.
 */
export async function getBuildStats(buildIds: string[]): Promise<Map<string, BuildMetaStats | null>> {
  const keys = [...new Set(buildIds)]
  const byKey = await mgetJson<BuildMetaStats>(keys.map(buildCacheKey))
  const hasAnyHit = [...byKey.values()].some((v) => v !== null)
  if (hasAnyHit || keys.length === 0) {
    return new Map(keys.map((id) => [id, byKey.get(buildCacheKey(id)) ?? null]))
  }
  const computed = await computeBuildWinRates()
  const byId = new Map(computed.map((c) => [c.id, c]))
  return new Map(keys.map((id) => [id, byId.get(id) ?? null]))
}

/** Batch-read cached PartMetaStats — same contract as getBuildStats. */
export async function getPartStats(partIds: string[]): Promise<Map<string, PartMetaStats | null>> {
  const keys = [...new Set(partIds)]
  const byKey = await mgetJson<PartMetaStats>(keys.map(partCacheKey))
  const hasAnyHit = [...byKey.values()].some((v) => v !== null)
  if (hasAnyHit || keys.length === 0) {
    return new Map(keys.map((id) => [id, byKey.get(partCacheKey(id)) ?? null]))
  }
  const computed = await computePartWinRates()
  const byId = new Map(computed.map((c) => [c.id, c]))
  return new Map(keys.map((id) => [id, byId.get(id) ?? null]))
}
