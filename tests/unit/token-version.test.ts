// tests/unit/token-version.test.ts
// Regression test for https://github.com/KernicDE/beybladex/issues/50: JWT session revocation
// via tokenVersion. A token minted before a security-relevant account change (GDPR erasure,
// TOTP deactivation) must stop authenticating at its next use instead of living out its 30 days.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getTokenVersion = vi.fn()
vi.mock('@/lib/tokenVersion', () => ({
  getTokenVersion: (...a: unknown[]) => getTokenVersion(...a),
  bumpTokenVersion: vi.fn(),
  invalidateTokenVersionCache: vi.fn(),
}))

// lib/auth (and its lib/redis import chain) creates ioredis clients at import time; swallow
// connection errors so this infra-free test doesn't die on an unhandled 'error' event.
import { redis, redisSubscriber } from '@/lib/redis'
redis.on('error', () => {})
redisSubscriber.on('error', () => {})

import { jwtCallback } from '@/lib/auth'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('jwtCallback tokenVersion revocation (issue #50)', () => {
  it('stamps the current tokenVersion into a fresh sign-in token', async () => {
    const token = await jwtCallback({ token: {}, user: { id: 'user-1', name: 'alice', tv: 3 } })
    expect(token).toMatchObject({ id: 'user-1', name: 'alice', tv: 3 })
    expect(getTokenVersion).not.toHaveBeenCalled()
  })

  it('accepts an existing token whose tv claim still matches the live version', async () => {
    getTokenVersion.mockResolvedValue(3)
    const token = await jwtCallback({ token: { id: 'user-1', name: 'alice', tv: 3 }, user: undefined })
    expect(token).toMatchObject({ id: 'user-1', tv: 3 })
    expect(getTokenVersion).toHaveBeenCalledWith('user-1')
  })

  it('INVALIDATES the token when the live version was bumped (erasure / TOTP disable)', async () => {
    // Token minted at tv=3; account action bumped the user to 4 → @auth/core treats null as
    // "invalidate session": the cookie is cleared and auth() returns null.
    getTokenVersion.mockResolvedValue(4)
    const token = await jwtCallback({ token: { id: 'user-1', name: 'alice', tv: 3 }, user: undefined })
    expect(token).toBeNull()
  })

  it('INVALIDATES the token when the user row no longer exists', async () => {
    getTokenVersion.mockResolvedValue(null)
    const token = await jwtCallback({ token: { id: 'gone-user', name: 'ghost', tv: 1 }, user: undefined })
    expect(token).toBeNull()
  })

  it('grandfathers pre-#50 tokens (no tv claim) onto the current version instead of logging out', async () => {
    getTokenVersion.mockResolvedValue(7)
    const token = await jwtCallback({ token: { id: 'user-1', name: 'alice' }, user: undefined })
    expect(token).toMatchObject({ id: 'user-1', tv: 7 })
  })
})
