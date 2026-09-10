// lib/redis.ts
import Redis, { type RedisOptions } from 'ioredis'

const globalForRedis = globalThis as unknown as { redis?: Redis; redisSubscriber?: Redis }

// Exponential backoff capped at 5s. Returning a number keeps ioredis retrying indefinitely
// so the app recovers on its own once Redis comes back — we never want to give up connecting.
function retryStrategy(times: number) {
  return Math.min(times * 200, 5000)
}

// Exported so tests can exercise the error-handling behavior on a throwaway client instead of
// emitting synthetic errors on the shared singletons below (which would corrupt their real
// connection state for every other test sharing this module).
export function createRedisClient(url: string, options: RedisOptions = {}) {
  const client = new Redis(url, {
    retryStrategy,
    maxRetriesPerRequest: 3,
    ...options,
  })

  // ioredis emits 'error' for every connection hiccup (ECONNREFUSED, timeouts, etc.). Without
  // a listener, Node treats it as an uncaughtException and kills the process — a transient
  // Redis blip must not take the whole app down.
  client.on('error', (err) => {
    console.error('[redis] connection error:', err)
  })

  return client
}

// Command connection: GET/SET/EXPIRE/pipelines — tile cache, rate limits, currency cache.
// enableOfflineQueue: false so these commands fail fast during an outage instead of queueing
// up and hanging the request until Redis returns.
export const redis =
  globalForRedis.redis ?? createRedisClient(process.env.REDIS_URL!, { enableOfflineQueue: false })

// Dedicated subscriber connection — the ONLY connection allowed to call .subscribe().
// Used by Phase 3's SSE notification stream and Phase 12's club-chat stream. Keeps the default
// offline queue so pending subscribe()/unsubscribe() calls survive a reconnect instead of
// rejecting outright.
export const redisSubscriber = globalForRedis.redisSubscriber ?? createRedisClient(process.env.REDIS_URL!)

if (process.env.NODE_ENV !== 'production') {
  globalForRedis.redis = redis
  globalForRedis.redisSubscriber = redisSubscriber
}
