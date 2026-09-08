// tests/integration/profile-rectification.test.ts
// Task 12: PATCH /api/profile (GDPR Art. 16). Integration — needs Postgres/Redis (CI-only,
// never run locally per Global Constraints' no-local-Docker rule).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import bcrypt from 'bcryptjs'
import { PATCH } from '@/app/api/profile/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

describe('PATCH /api/profile (rectification, Art. 16)', () => {
  const username = `rect_${Date.now().toString(36)}`
  let userId: string

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash: await bcrypt.hash('correct horse battery staple', 12),
        birthDate: new Date('1990-01-01'),
        isMinor: false,
      },
    })
    userId = user.id
    mockAuth.mockResolvedValue(asSession({ id: userId, name: username }))
  })

  afterEach(async () => {
    mockAuth.mockReset()
    await prisma.user.deleteMany({ where: { id: userId } })
  })

  it('updates whitelisted profile fields for the owner', async () => {
    const req = new Request('http://localhost/api/profile', {
      method: 'PATCH',
      body: JSON.stringify({ displayName: 'Maxi M.', bio: 'Blader aus Berlin', city: 'Berlin', postalCode: '10115', state: 'Berlin', country: 'AT', discordTag: 'maxi#1234' }),
    })
    const res = await PATCH(req)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ displayName: 'Maxi M.', bio: 'Blader aus Berlin', city: 'Berlin', postalCode: '10115', state: 'Berlin', country: 'AT', discordTag: 'maxi#1234' })
  })

  it('a birthDate edit recomputes isMinor in both directions — lowering is accepted (late-reported minor), raising needs no new consent flow', async () => {
    // adult → minor: accepted as-is (the minor ceilings in lib/privacy.ts protect the account)
    const lower = await PATCH(new Request('http://localhost/api/profile', {
      method: 'PATCH',
      body: JSON.stringify({ birthDate: '2015-06-01' }),
    }))
    expect(lower.status).toBe(200)
    let user = await prisma.user.findUnique({ where: { id: userId } })
    expect(user!.isMinor).toBe(true)

    // minor → adult: flips isMinor back to false WITHOUT a parental-consent re-run — the
    // documented Task 12 asymmetry: becoming less restricted is never the harm Art. 8 guards.
    const raise = await PATCH(new Request('http://localhost/api/profile', {
      method: 'PATCH',
      body: JSON.stringify({ birthDate: '1990-01-01' }),
    }))
    expect(raise.status).toBe(200)
    user = await prisma.user.findUnique({ where: { id: userId } })
    expect(user!.isMinor).toBe(false)
    expect(user!.status).toBe('ACTIVE') // not re-flagged into a consent flow
  })

  it('rejects a birthDate in the future', async () => {
    const res = await PATCH(new Request('http://localhost/api/profile', {
      method: 'PATCH',
      body: JSON.stringify({ birthDate: '2999-01-01' }),
    }))
    expect(res.status).toBe(400)
  })

  it('returns 403 when the body names a different userId (non-owner negative test)', async () => {
    const other = await prisma.user.create({ data: { username: `other_${Date.now().toString(36)}`, passwordHash: 'x' } })
    const res = await PATCH(new Request('http://localhost/api/profile', {
      method: 'PATCH',
      body: JSON.stringify({ userId: other.id, displayName: 'Übernahmeversuch' }),
    }))
    expect(res.status).toBe(403)
    const untouched = await prisma.user.findUnique({ where: { id: other.id } })
    expect(untouched!.displayName).toBeNull()
    await prisma.user.delete({ where: { id: other.id } })
  })

  it('ignores non-whitelisted fields like username', async () => {
    const res = await PATCH(new Request('http://localhost/api/profile', {
      method: 'PATCH',
      body: JSON.stringify({ username: 'hacked_name', displayName: 'Noch immer ich' }),
    }))
    expect(res.status).toBe(200)
    const user = await prisma.user.findUnique({ where: { id: userId } })
    expect(user!.username).toBe(username)
    expect(user!.displayName).toBe('Noch immer ich')
  })

  it('returns 401 without a session', async () => {
    mockAuth.mockResolvedValue(asSession(null))
    const res = await PATCH(new Request('http://localhost/api/profile', {
      method: 'PATCH',
      body: JSON.stringify({ displayName: 'Niemand' }),
    }))
    expect(res.status).toBe(401)
  })
})
