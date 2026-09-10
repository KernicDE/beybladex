// tests/unit/tournament-rate-limit.test.ts
// Regression test for https://github.com/KernicDE/beybladex/issues/37: mutating tournament
// endpoints must enforce a per-user rate limit so a compromised organizer/judge session cannot
// flood expensive mutations (esp. transactional bracket generation). Exercised here on the
// `complete` endpoint as the representative of the 14 covered routes.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const auth = vi.fn()
const rateLimit = vi.fn()
const tournamentFindUnique = vi.fn()
const userFindUnique = vi.fn()
const tournamentUpdate = vi.fn()

vi.mock('@/lib/auth', () => ({ auth: (...a: unknown[]) => auth(...a) }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }))
vi.mock('@/lib/db', () => ({
  prisma: {
    tournament: {
      findUnique: (...a: unknown[]) => tournamentFindUnique(...a),
      update: (...a: unknown[]) => tournamentUpdate(...a),
    },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
  },
}))

import { POST } from '@/app/api/tournaments/[id]/complete/route'

const ORGANIZER = { id: 'organizer-user-id' }
const params = Promise.resolve({ id: 'tournament-1' })

beforeEach(() => {
  vi.clearAllMocks()
  auth.mockResolvedValue({ user: { id: ORGANIZER.id } })
  tournamentFindUnique.mockResolvedValue({ createdById: ORGANIZER.id, completedAt: null })
  userFindUnique.mockResolvedValue({ role: 'USER' })
  tournamentUpdate.mockResolvedValue({ id: 'tournament-1' })
})

describe('POST /api/tournaments/[id]/complete rate limiting (issue #37)', () => {
  it('returns 429 and skips all DB work when the rate limiter denies', async () => {
    rateLimit.mockResolvedValue({ allowed: false, remaining: 0 })

    const res = await POST(new Request('http://localhost/api/tournaments/tournament-1/complete', { method: 'POST' }), { params })

    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'rate_limited' })
    // The limiter short-circuits BEFORE any tournament lookup/mutation happened.
    expect(tournamentFindUnique).not.toHaveBeenCalled()
    expect(tournamentUpdate).not.toHaveBeenCalled()
    // …and it was keyed per authenticated user, not per IP.
    expect(rateLimit).toHaveBeenCalledWith(`tournament:complete:${ORGANIZER.id}`, 30, 60)
  })

  it('proceeds normally when the rate limiter allows', async () => {
    rateLimit.mockResolvedValue({ allowed: true, remaining: 29 })

    const res = await POST(new Request('http://localhost/api/tournaments/tournament-1/complete', { method: 'POST' }), { params })

    expect(res.status).toBe(200)
    expect(tournamentUpdate).toHaveBeenCalled()
  })

  it('unauthenticated callers are still rejected before the limiter runs', async () => {
    auth.mockResolvedValue(null)

    const res = await POST(new Request('http://localhost/api/tournaments/tournament-1/complete', { method: 'POST' }), { params })

    expect(res.status).toBe(401)
    expect(rateLimit).not.toHaveBeenCalled()
  })
})
