// tests/integration/redis-client.test.ts
// Touches Redis — lives under tests/integration (CI-only), not tests/unit.
//
// Regression test for a transient Redis connection error crashing the whole Node process:
// ioredis clients created without an 'error' listener turn every connection hiccup into an
// uncaughtException. Vitest itself would abort the run if that happened here, so simply
// reaching the assertions below (without the process dying) is the proof.
import { describe, it, expect, vi } from 'vitest'
import { redis, redisSubscriber } from '@/lib/redis'

describe('redis clients', () => {
  it('have an error listener registered so a connection error does not crash the process', () => {
    expect(redis.listenerCount('error')).toBeGreaterThan(0)
    expect(redisSubscriber.listenerCount('error')).toBeGreaterThan(0)
  })

  it('logs instead of throwing when the command connection emits an error', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() => redis.emit('error', new Error('ECONNREFUSED (simulated)'))).not.toThrow()
      expect(errorSpy).toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('logs instead of throwing when the subscriber connection emits an error', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() => redisSubscriber.emit('error', new Error('ECONNREFUSED (simulated)'))).not.toThrow()
      expect(errorSpy).toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })
})
