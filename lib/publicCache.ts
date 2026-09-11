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
//   dependency. Mutation-triggered invalidation is unnecessary at these TTLs; a stale entry
//   lives at most one TTL window.
import { redis } from '@/lib/redis'

function encode(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (v instanceof Date ? { $d: v.toISOString() } : v))
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
