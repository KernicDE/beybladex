// lib/rateLimit.ts
import { redis } from '@/lib/redis'

// [REVIEW-FIX: performance P7] atomic INCR+EXPIRE via Lua — a plain INCR-then-EXPIRE pair is two
// round trips AND has a race: if the process dies between them, the key survives with no TTL and
// permanently locks out that (ip, route) bucket. One eval call closes both the latency and the bug.
const LIMITER_LUA = `
  local count = redis.call('INCR', KEYS[1])
  if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
  return count`

export async function rateLimit(key: string, limit: number, windowSeconds: number) {
  const redisKey = `ratelimit:${key}`
  const count = (await redis.eval(LIMITER_LUA, 1, redisKey, windowSeconds)) as number
  return { allowed: count <= limit, remaining: Math.max(0, limit - count) }
}
