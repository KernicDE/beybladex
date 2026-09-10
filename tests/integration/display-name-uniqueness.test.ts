// tests/integration/display-name-uniqueness.test.ts
// Phase 19: User.displayNameNormalized (@unique) — two users cannot hold display names that
// normalize (trim().toLowerCase().normalize('NFKC')) to the same value. Integration — needs
// Postgres/Redis (CI-only, never run locally per Global Constraints' no-local-Docker rule).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import bcrypt from 'bcryptjs'
import { PATCH } from '@/app/api/profile/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'
import { normalizeDisplayName } from '@/lib/displayName'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

async function patchDisplayName(userId: string, displayName: string | null) {
  mockAuth.mockResolvedValue(asSession({ id: userId, name: userId }))
  return PATCH(new Request('http://localhost/api/profile', {
    method: 'PATCH',
    body: JSON.stringify({ displayName }),
  }))
}

describe('PATCH /api/profile — displayNameNormalized uniqueness (Phase 19)', () => {
  const usernameA = `dn_a_${Date.now().toString(36)}`
  const usernameB = `dn_b_${Date.now().toString(36)}`
  let userIdA: string
  let userIdB: string

  beforeEach(async () => {
    const a = await prisma.user.create({
      data: { username: usernameA, passwordHash: await bcrypt.hash('correct horse battery staple', 12), birthDate: new Date('1990-01-01'), isMinor: false },
    })
    const b = await prisma.user.create({
      data: { username: usernameB, passwordHash: await bcrypt.hash('correct horse battery staple', 12), birthDate: new Date('1990-01-01'), isMinor: false },
    })
    userIdA = a.id
    userIdB = b.id
  })

  afterEach(async () => {
    mockAuth.mockReset()
    await prisma.user.deleteMany({ where: { id: { in: [userIdA, userIdB] } } })
  })

  it('stores displayNameNormalized alongside displayName on write', async () => {
    const res = await patchDisplayName(userIdA, 'Max Mustermann')
    expect(res.status).toBe(200)
    const user = await prisma.user.findUnique({ where: { id: userIdA } })
    expect(user!.displayName).toBe('Max Mustermann')
    expect(user!.displayNameNormalized).toBe('max mustermann')
  })

  it('rejects a second user whose display name normalizes to the same value (409 displayname_taken)', async () => {
    const first = await patchDisplayName(userIdA, 'MaxMustermann')
    expect(first.status).toBe(200)

    const second = await patchDisplayName(userIdB, 'maxmustermann')
    expect(second.status).toBe(409)
    expect((await second.json()).error).toBe('displayname_taken')
    const loser = await prisma.user.findUnique({ where: { id: userIdB } })
    expect(loser!.displayName).toBeNull()
    expect(loser!.displayNameNormalized).toBeNull()
  })

  it('rejects names that collide only after NFKC folding', async () => {
    const first = await patchDisplayName(userIdA, 'Max')
    expect(first.status).toBe(200)
    // 'Ｍａｘ' (fullwidth) normalizes to 'max'
    const second = await patchDisplayName(userIdB, 'Ｍａｘ')
    expect(second.status).toBe(409)
    expect((await second.json()).error).toBe('displayname_taken')
  })

  it('allows both users to have a null display name (NULLs never collide)', async () => {
    const a = await patchDisplayName(userIdA, null)
    expect(a.status).toBe(200)
    const b = await patchDisplayName(userIdB, null)
    expect(b.status).toBe(200)
  })

  it('allows changing an existing display name to a still-unique value', async () => {
    const first = await patchDisplayName(userIdA, 'Alter Name')
    expect(first.status).toBe(200)
    const second = await patchDisplayName(userIdA, 'Neuer Name')
    expect(second.status).toBe(200)
    const user = await prisma.user.findUnique({ where: { id: userIdA } })
    expect(user!.displayName).toBe('Neuer Name')
    expect(user!.displayNameNormalized).toBe(normalizeDisplayName('Neuer Name'))
  })

  it('allows re-saving your own unchanged display name (no self-collision)', async () => {
    const first = await patchDisplayName(userIdA, 'Wieder Ich')
    expect(first.status).toBe(200)
    const again = await patchDisplayName(userIdA, 'Wieder Ich')
    expect(again.status).toBe(200)
  })

  it('clears displayNameNormalized when the display name is cleared', async () => {
    const set = await patchDisplayName(userIdA, 'Vorübergehend')
    expect(set.status).toBe(200)
    const cleared = await patchDisplayName(userIdA, null)
    expect(cleared.status).toBe(200)
    const user = await prisma.user.findUnique({ where: { id: userIdA } })
    expect(user!.displayName).toBeNull()
    expect(user!.displayNameNormalized).toBeNull()
  })

  it('account erasure stays repeatable: two erased users share the tombstone displayName but not its normalized form', async () => {
    const { eraseOrAnonymizeUser } = await import('@/lib/accountErasure')
    await eraseOrAnonymizeUser(userIdA)
    await eraseOrAnonymizeUser(userIdB) // a second erasure must not die on the unique index (P2002)
    const a = await prisma.user.findUnique({ where: { id: userIdA } })
    const b = await prisma.user.findUnique({ where: { id: userIdB } })
    expect(a!.displayName).toBe('Gelöschter Nutzer')
    expect(b!.displayName).toBe('Gelöschter Nutzer')
    expect(a!.displayNameNormalized).not.toBe(b!.displayNameNormalized)
  })
})
