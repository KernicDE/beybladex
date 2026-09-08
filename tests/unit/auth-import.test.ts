// Regression guard for the CI failure where vitest's externalized native ESM loader could not
// resolve next-auth@5.0.0-beta.32's extensionless `next/server` import (next 16 has no exports
// map). vitest.config.mts inlines next-auth so Vite's resolver handles it; this test fails
// loudly if that config is lost. Pure module-loading check — no DB/Redis needed.
import { describe, it, expect } from 'vitest'

// lib/redis creates ioredis clients at import time; swallow connection errors so this
// infra-free test doesn't die on an unhandled 'error' event in a later tick.
import { redis, redisSubscriber } from '@/lib/redis'
redis.on('error', () => {})
redisSubscriber.on('error', () => {})

describe('next-auth module resolution', () => {
  it('importing next-auth does not throw ERR_MODULE_NOT_FOUND for next/server', async () => {
    const mod = await import('next-auth')
    expect(typeof mod.default).toBe('function')
  })

  it('the real integration-test import chain (signIn from @/lib/auth) loads', async () => {
    const { signIn } = await import('@/lib/auth')
    expect(typeof signIn).toBe('function')
  })
})
