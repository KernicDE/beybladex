// tests/unit/rate-limit-redis-failure.test.ts (RC3 issue #49)
// A Redis outage must never surface as an unhandled 500 from a rate-limited route. The limiter
// catches the Redis error, logs it, and falls back to a defined per-callsite policy:
// - default (UX routes): fail-OPEN — the request is allowed so a Redis blip doesn't take the app down
// - { onRedisError: 'closed' } (register/webauthn): fail-CLOSED — the request is denied (429)
// @/lib/redis is mocked with a failing eval, mirroring the seam-mock pattern of
// tests/unit/notify-triggers.test.ts — no real Redis involved.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const evalMock = vi.fn()

vi.mock('@/lib/redis', () => ({ redis: { eval: (...a: unknown[]) => evalMock(...a) } }))

import { rateLimit } from '@/lib/rateLimit'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('rateLimit Redis failover (issue #49)', () => {
  it('does not throw when redis.eval rejects', async () => {
    evalMock.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(rateLimit('test:key', 5, 60)).resolves.toBeDefined()
    expect(evalMock).toHaveBeenCalled()
  })

  it('fails OPEN by default (UX policy): allows the request and logs the error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    evalMock.mockRejectedValue(new Error('Connection timeout'))

    const result = await rateLimit('ux-route:user-1', 30, 60)

    expect(result).toEqual({ allowed: true, remaining: 30 })
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('ratelimit:ux-route:user-1'), expect.any(Error))
    consoleError.mockRestore()
  })

  it("fails CLOSED with onRedisError: 'closed' (security policy): denies the request", async () => {
    evalMock.mockRejectedValue(new Error('ECONNREFUSED'))

    const result = await rateLimit('register:10.0.0.1', 5, 900, { onRedisError: 'closed' })

    expect(result).toEqual({ allowed: false, remaining: 0 })
  })

  it('still applies the limit normally when Redis is healthy', async () => {
    evalMock.mockResolvedValue(7)

    const result = await rateLimit('healthy:key', 5, 60)

    expect(result).toEqual({ allowed: false, remaining: 0 })
  })
})
