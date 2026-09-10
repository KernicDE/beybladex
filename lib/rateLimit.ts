// lib/rateLimit.ts
import { redis } from '@/lib/redis'

// [REVIEW-FIX: performance P7] atomic INCR+EXPIRE via Lua — a plain INCR-then-EXPIRE pair is two
// round trips AND has a race: if the process dies between them, the key survives with no TTL and
// permanently locks out that (ip, route) bucket. One eval call closes both the latency and the bug.
const LIMITER_LUA = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
  return count`

// [RC3 #49] Failover policy for a Redis outage. Deliberately per-callsite, not global:
// - 'open' (default): without a working limiter the route keeps serving. Right for the ~40
//   authenticated UX mutations (club chat, ratings, profile, …): a Redis blip must not take the
//   whole app down, and the caller is a logged-in user, so abuse potential is bounded.
// - 'closed': the limiter denies the request (the route answers 429 as usual). Reserved for the
//   credential-issuing / brute-force-sensitive entry points (register, webauthn authenticate/
//   register): there a missing limiter would remove the ONLY throttle on passwordless credential
//   creation and login attempts, so we accept temporary unavailability over unthrottled access.
// Either way the Redis error is logged and never propagates — a limiter failure must never
// become an unhandled 500 on the protected route.
export type RateLimitFailover = 'open' | 'closed'

export async function rateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  opts?: { onRedisError?: RateLimitFailover },
): Promise<{ allowed: boolean; remaining: number }> {
  const redisKey = `ratelimit:${key}`
  try {
    const count = (await redis.eval(LIMITER_LUA, 1, redisKey, windowSeconds)) as number
    return { allowed: count <= limit, remaining: Math.max(0, limit - count) }
  } catch (err) {
    console.error(`[rateLimit] redis eval failed for ${redisKey}:`, err)
    if (opts?.onRedisError === 'closed') return { allowed: false, remaining: 0 }
    return { allowed: true, remaining: limit }
  }
}
