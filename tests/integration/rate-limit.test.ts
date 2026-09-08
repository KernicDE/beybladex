// tests/integration/rate-limit.test.ts
// Touches Redis — lives under tests/integration (CI-only), not tests/unit.
import { describe, it, expect, beforeEach } from 'vitest'
import { rateLimit } from '@/lib/rateLimit'
import { redis } from '@/lib/redis'

describe('rateLimit', () => {
  beforeEach(async () => {
    await redis.del('ratelimit:test-key')
  })

  it('allows up to the limit within the window, then blocks', async () => {
    for (let i = 0; i < 5; i++) {
      const result = await rateLimit('test-key', 5, 60)
      expect(result.allowed).toBe(true)
    }
    const sixth = await rateLimit('test-key', 5, 60)
    expect(sixth.allowed).toBe(false)
  })
})
