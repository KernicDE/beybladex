// lib/redis.ts
import Redis from 'ioredis'

const globalForRedis = globalThis as unknown as { redis?: Redis; redisSubscriber?: Redis }

// Command connection: GET/SET/EXPIRE/pipelines — tile cache, rate limits, currency cache.
export const redis = globalForRedis.redis ?? new Redis(process.env.REDIS_URL!)

// Dedicated subscriber connection — the ONLY connection allowed to call .subscribe().
// Used by Phase 3's SSE notification stream and Phase 12's club-chat stream.
export const redisSubscriber = globalForRedis.redisSubscriber ?? new Redis(process.env.REDIS_URL!)

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis
  globalForRedis.redisSubscriber = redisSubscriber
}
