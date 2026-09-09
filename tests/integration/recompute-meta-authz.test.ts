// tests/integration/recompute-meta-authz.test.ts
// Phase 5 Part D — the internal recompute trigger is NOT a public API: it rejects requests
// without or with a wrong x-cron-secret (401) and only accepts the correct INTERNAL_CRON_SECRET
// (the exact shared-secret pattern of cleanup-notifications, per the standing negative-authz
// test rule). Integration — CI-only (a correct-secret call touches Redis via recomputeDirtyMeta;
// wrong-secret calls short-circuit before any I/O, but the file lives with the other
// integration tests per the plan's file list).
import { describe, it, expect, afterAll } from 'vitest'
import { POST } from '@/app/api/internal/recompute-meta/route'

describe('POST /api/internal/recompute-meta authz', () => {
  const ORIGINAL = process.env.INTERNAL_CRON_SECRET
  afterAll(() => {
    if (ORIGINAL === undefined) delete process.env.INTERNAL_CRON_SECRET
    else process.env.INTERNAL_CRON_SECRET = ORIGINAL
  })

  it('rejects a request without x-cron-secret (401)', async () => {
    process.env.INTERNAL_CRON_SECRET = 'test-cron-secret'
    const res = await POST(new Request('http://localhost/api/internal/recompute-meta', { method: 'POST' }))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('unauthorized')
  })

  it('rejects a request with a wrong x-cron-secret (401)', async () => {
    process.env.INTERNAL_CRON_SECRET = 'test-cron-secret'
    const res = await POST(
      new Request('http://localhost/api/internal/recompute-meta', {
        method: 'POST',
        headers: { 'x-cron-secret': 'wrong-secret' },
      }),
    )
    expect(res.status).toBe(401)
  })

  it('rejects a wrong-length secret without timing leaks (401)', async () => {
    process.env.INTERNAL_CRON_SECRET = 'test-cron-secret'
    const res = await POST(
      new Request('http://localhost/api/internal/recompute-meta', {
        method: 'POST',
        headers: { 'x-cron-secret': 'x' },
      }),
    )
    expect(res.status).toBe(401)
  })

  it('accepts the correct x-cron-secret (200)', async () => {
    process.env.INTERNAL_CRON_SECRET = 'test-cron-secret'
    const res = await POST(
      new Request('http://localhost/api/internal/recompute-meta', {
        method: 'POST',
        headers: { 'x-cron-secret': 'test-cron-secret' },
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toHaveProperty('parts')
    expect(body).toHaveProperty('builds')
  })
})
