// tests/unit/guards.test.ts (RC4, issue #48)
// Unit coverage for lib/guards.ts: the central auth guards must reproduce the exact
// 401/403 contracts the previously inline-duplicated prologues had (same error tokens, same
// status codes), so every migrated route keeps its behavior. Seam-mocks on '@/lib/auth' and
// '@/lib/db' (the two imports the guards actually use) — no Node-builtin mocking.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const auth = vi.fn()
const findUnique = vi.fn()
vi.mock('@/lib/auth', () => ({ auth: (...a: unknown[]) => auth(...a) }))
vi.mock('@/lib/db', () => ({ prisma: { user: { findUnique: (...a: unknown[]) => findUnique(...a) } } }))

import { requireUser, requireRole, requireCurator, requireAdmin, getCallerRole } from '@/lib/guards'

function asSession(id: string | null) {
  return (id ? { user: { id, name: id }, expires: '2099-01-01T00:00:00.000Z' } : null) as never
}

function asUser(role: string | null) {
  return role === null ? null : { role }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('requireUser', () => {
  it('returns 401 with the canonical token when there is no session', async () => {
    auth.mockResolvedValue(null)
    const gate = await requireUser()
    expect('error' in gate).toBe(true)
    if (!('error' in gate)) return
    expect(gate.error.status).toBe(401)
    expect(await gate.error.json()).toEqual({ error: 'unauthorized' })
    expect(findUnique).not.toHaveBeenCalled()
  })

  it('returns 401 when the session has no user id', async () => {
    auth.mockResolvedValue({ user: {} })
    const gate = await requireUser()
    expect('error' in gate).toBe(true)
    if ('error' in gate) expect(gate.error.status).toBe(401)
  })

  it('returns the userId for an authenticated caller without touching the DB', async () => {
    auth.mockResolvedValue(asSession('user-1'))
    const gate = await requireUser()
    expect(gate).toEqual({ userId: 'user-1' })
    expect(findUnique).not.toHaveBeenCalled()
  })
})

describe('requireRole', () => {
  it('403 for an authenticated caller whose role is not in the list', async () => {
    auth.mockResolvedValue(asSession('user-1'))
    findUnique.mockResolvedValue(asUser('USER'))
    const gate = await requireRole('ORGANIZER', 'ADMIN')
    expect('error' in gate).toBe(true)
    if (!('error' in gate)) return
    expect(gate.error.status).toBe(403)
    expect(await gate.error.json()).toEqual({ error: 'forbidden' })
  })

  it('401 short-circuits before the role read when unauthenticated', async () => {
    auth.mockResolvedValue(null)
    const gate = await requireRole('ADMIN')
    expect('error' in gate).toBe(true)
    if ('error' in gate) expect(gate.error.status).toBe(401)
    expect(findUnique).not.toHaveBeenCalled()
  })

  it('passes the role through on success', async () => {
    auth.mockResolvedValue(asSession('user-1'))
    findUnique.mockResolvedValue(asUser('ORGANIZER'))
    expect(await requireRole('ORGANIZER', 'ADMIN')).toEqual({ userId: 'user-1', role: 'ORGANIZER' })
  })

  it('403 when the user row no longer exists (revoked mid-flight)', async () => {
    auth.mockResolvedValue(asSession('ghost'))
    findUnique.mockResolvedValue(null)
    const gate = await requireRole('ADMIN')
    expect('error' in gate).toBe(true)
    if ('error' in gate) expect(gate.error.status).toBe(403)
  })
})

describe('requireCurator (issue #42 tier: TRUSTED/JUDGE/ORGANIZER/ADMIN)', () => {
  it.each(['TRUSTED', 'JUDGE', 'ORGANIZER', 'ADMIN'])('allows %s', async (role) => {
    auth.mockResolvedValue(asSession('user-1'))
    findUnique.mockResolvedValue(asUser(role))
    expect(await requireCurator()).toEqual({ userId: 'user-1', role })
  })

  it.each(['GUEST', 'USER'])('403 for %s', async (role) => {
    auth.mockResolvedValue(asSession('user-1'))
    findUnique.mockResolvedValue(asUser(role))
    const gate = await requireCurator()
    expect('error' in gate).toBe(true)
    if ('error' in gate) expect(gate.error.status).toBe(403)
  })
})

describe('requireAdmin', () => {
  it('allows only ADMIN', async () => {
    auth.mockResolvedValue(asSession('user-1'))
    findUnique.mockResolvedValue(asUser('ADMIN'))
    expect(await requireAdmin()).toEqual({ userId: 'user-1', role: 'ADMIN' })
  })

  it('403 for ORGANIZER (the tier below ADMIN)', async () => {
    auth.mockResolvedValue(asSession('user-1'))
    findUnique.mockResolvedValue(asUser('ORGANIZER'))
    const gate = await requireAdmin()
    expect('error' in gate).toBe(true)
    if ('error' in gate) expect(gate.error.status).toBe(403)
  })
})

describe('getCallerRole', () => {
  it('returns the live role, null for a missing user', async () => {
    findUnique.mockResolvedValueOnce(asUser('JUDGE')).mockResolvedValueOnce(null)
    expect(await getCallerRole('user-1')).toBe('JUDGE')
    expect(await getCallerRole('ghost')).toBeNull()
  })
})
