// tests/integration/redis-client.test.ts
// Touches Redis — lives under tests/integration (CI-only), not tests/unit.
//
// Regression test for a transient Redis connection error crashing the whole Node process:
// ioredis clients created without an 'error' listener turn every connection hiccup into an
// uncaughtException. Vitest itself would abort the run if that happened here, so simply
// reaching the assertions below (without the process dying) is the proof.
//
// IMPORTANT: never emit a synthetic 'error' on the shared `redis`/`redisSubscriber` singletons
// here — that mutates their real connection state for the rest of the suite (other test files
// import the same cached instances). Exercise `createRedisClient` on a throwaway client instead.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { redis, redisSubscriber, createRedisClient } from '@/lib/redis'

describe('redis clients', () => {
  it('have an error listener registered so a connection error does not crash the process', () => {
    expect(redis.listenerCount('error')).toBeGreaterThan(0)
    expect(redisSubscriber.listenerCount('error')).toBeGreaterThan(0)
  })

  describe('createRedisClient', () => {
    let client: ReturnType<typeof createRedisClient> | undefined

    afterEach(() => {
      client?.disconnect()
      client = undefined
    })

    it('logs instead of throwing when the connection emits an error', () => {
      // lazyConnect: true so constructing this client never attempts a real connection.
      client = createRedisClient(process.env.REDIS_URL!, { lazyConnect: true })

      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      try {
        expect(() => client!.emit('error', new Error('ECONNREFUSED (simulated)'))).not.toThrow()
        expect(errorSpy).toHaveBeenCalled()
      } finally {
        errorSpy.mockRestore()
      }
    })
  })
})
