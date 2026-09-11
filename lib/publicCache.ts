// lib/publicCache.ts (RC5 issue #43)
// Short-TTL Redis cache for the PUBLIC query cores of the heavily-hit, anonymous-friendly
// pages (/events, /events/[id], /clubs, /clubs/[slug]).
//
// WHY THIS EXISTS (the issue's option B, chosen over a "static shell + client session
// components" split): in this app's Next 16 setup (no cacheComponents — see next.config.ts),
// ANY read of request-bound input opts the whole route into per-request rendering. All four
// pages read `searchParams` (filter/pagination state) and/or `auth()` (session-gated UI), so
// no full-page ISR/`revalidate` export can ever apply — the old `export const revalidate`
// lines were dead config that only LOOKED like caching. What CAN be cached is the expensive,
// fully public part: the Prisma query result every viewer shares. That is what this helper
// caches, with the TTLs the removed revalidate exports originally promised (events 60s,
// clubs 120s).
//
// Contract:
// - Date-safe round-trip: Prisma results carry Date objects; they are tagged during
//   serialization and revived on read, so cached rows behave byte-identically to fresh ones.
// - null/undefined results are NOT cached (a just-created row must appear immediately).
// - Redis failures degrade to "run the query" — the cache is an optimization, never a
//   dependency.
//
// KEY INVENTORY (who writes / who invalidates — hotfix #99):
// - public:v1:events:list:<filter-signature>  — app/events/page.tsx (TTL 60s). NOT
//   invalidated by tournament routes: the signature is filter/pagination state, so there is
//   no single key to DEL; a PATCH can leave the list stale for at most one TTL window.
// - public:v2:tournament:<id>                 — app/events/[id]/page.tsx (TTL 60s).
//   Invalidated (invalidatePublicCache) by every route that mutates state the public
//   detail SELECT reads: PATCH/DELETE [id], join (POST/DELETE withdraw), checkin,
//   header-image, stages (create/delete), stages generate/complete, start, complete,
//   noshow, and /api/matches/[id]/score (match status/winner feed the bracket preview).
// - public:v1:club:<slug>, public:v1:club-events:<clubId> — clubs pages (TTL 120s).
//   Tournament routes do not touch club state; TTL-bounded.
// - public:v1:landing:upcoming-events     — app/page.tsx guest landing teaser (TTL 60s).
//   TTL-bounded, not invalidated; empty results are not cached (produce returns null), so
//   the first published event appears on the landing page immediately.
import { redis } from '@/lib/redis'

function encode(value: unknown): string {
  // The replacer MUST read the original value from the holder (`this[key]`): Date.prototype.toJSON
  // runs BEFORE the replacer, so the `v` argument is already an ISO string and `v instanceof Date`
  // is never true — the $d tag never got written and cache hits returned raw strings (hotfix #126,
  // `toLocaleDateString is not a function` on /clubs/[slug]).
  return JSON.stringify(value, function (this: Record<string, unknown>, key: string, v: unknown) {
    const original = this[key]
    return original instanceof Date ? { $d: original.toISOString() } : v
  })
}

function decode<T>(raw: string): T {
  return JSON.parse(raw, (_key, v: unknown) => {
    if (
      typeof v === 'object' && v !== null && !Array.isArray(v) &&
      Object.keys(v as Record<string, unknown>).length === 1 &&
      typeof (v as { $d?: unknown }).$d === 'string'
    ) {
      return new Date((v as { $d: string }).$d)
    }
    return v
  }) as T
}

export async function withPublicCache<T>(key: string, ttlSeconds: number, produce: () => Promise<T>): Promise<T> {
  try {
    const hit = await redis.get(key)
    if (hit !== null) return decode<T>(hit)
  } catch (err) {
    console.error(`[publicCache] GET ${key} failed:`, err)
  }
  const value = await produce()
  if (value === null || value === undefined) return value
  try {
    await redis.set(key, encode(value), 'EX', ttlSeconds)
  } catch (err) {
    console.error(`[publicCache] SET ${key} failed:`, err)
  }
  return value
}

/** Redis key of the cached PUBLIC detail query for one tournament (app/events/[id]/page.tsx).
 *  v2 (#12): the payload additionally carries teamMode + teamEntries (with team, slots and
 *  slot users) for the 3-vs-3 team competition — the fresh key avoids up to 60s of stale v1
 *  rows without the fields (same v2-bump convention as the clubs list, #83). */
export function publicTournamentKey(id: string): string {
  return `public:v2:tournament:${id}`
}

/**
 * Mutation-triggered invalidation (hotfix #99). Call AFTER the DB write succeeded. Degrades
 * to a logged no-op on Redis failure — same contract as withPublicCache: the cache is an
 * optimization, never a dependency, so a missed DEL must never fail the mutation.
 */
export async function invalidatePublicCache(key: string): Promise<void> {
  try {
    await redis.del(key)
  } catch (err) {
    console.error(`[publicCache] DEL ${key} failed:`, err)
  }
}
