// tests/unit/admin-parts-curator.test.ts (RC4, issue #42)
// Regression for the curator-tier drift: app/api/admin/parts hardcoded TRUSTED/ADMIN and 403'd
// JUDGE/ORGANIZER even though the same people may approve proposals and create official Sets.
// With the route on lib/guards.ts requireCurator (lib/roles.ts CURATOR_ROLES), a JUDGE/
// ORGANIZER session gets PAST the gate — a malformed body then yields 400 from the validator,
// never 403 from the gate. Runs locally (Seam-Mocks on '@/lib/auth', '@/lib/db',
// '@/lib/rateLimit'); the full DB-backed authz matrix lives in
// tests/integration/parts-admin.test.ts (CI).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const auth = vi.fn()
const findUnique = vi.fn()
const rateLimit = vi.fn()
vi.mock('@/lib/auth', () => ({ auth: (...a: unknown[]) => auth(...a) }))
vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findUnique: (...a: unknown[]) => findUnique(...a) },
    part: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }))

import { POST } from '@/app/api/admin/parts/route'

function asSession(id: string) {
  return { user: { id, name: id }, expires: '2099-01-01T00:00:00.000Z' } as never
}

function post(body: unknown) {
  return new Request('http://localhost/api/admin/parts', { method: 'POST', body: JSON.stringify(body) })
}

beforeEach(() => {
  vi.clearAllMocks()
  rateLimit.mockResolvedValue({ allowed: true })
})

describe('POST /api/admin/parts curator gate (issue #42)', () => {
  it.each(['TRUSTED', 'JUDGE', 'ORGANIZER', 'ADMIN'])(
    '%s passes the gate; a malformed body is rejected by the validator with 400, not 403',
    async (role) => {
      auth.mockResolvedValue(asSession('user-1'))
      findUnique.mockResolvedValue({ role })
      const res = await POST(post({ name: 42 })) // wrong type → validator errors
      expect(res.status).toBe(400)
      const body = (await res.json()) as { error: string }
      expect(body.error).not.toBe('forbidden')
    },
  )

  it.each(['GUEST', 'USER'])('%s still gets 403 from the gate', async (role) => {
    auth.mockResolvedValue(asSession('user-1'))
    findUnique.mockResolvedValue({ role })
    const res = await POST(post({}))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'forbidden' })
  })

  it('unauthenticated gets 401 without any role read', async () => {
    auth.mockResolvedValue(null)
    const res = await POST(post({}))
    expect(res.status).toBe(401)
    expect(findUnique).not.toHaveBeenCalled()
  })
})
