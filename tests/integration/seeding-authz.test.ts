// tests/integration/seeding-authz.test.ts (Phase 15)
// Integration — CI-only (Postgres). Standing Global-Constraints requirement: every state-
// changing route has a negative authz test. PATCH /api/tournaments/[id]/participants/seed is
// owner/ADMIN-only, same tier as every other OrganizerConsole action. Also covers the "manual
// overrides always win" acceptance criterion end to end.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { PATCH } from '@/app/api/tournaments/[id]/participants/seed/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

function patch(body: unknown) {
  return new Request('http://localhost/x', { method: 'PATCH', body: JSON.stringify(body) })
}

async function seedUser(suffix: string, prefix: string, role: 'USER' | 'ORGANIZER' | 'ADMIN' = 'USER') {
  return prisma.user.create({ data: { username: `${prefix}_${suffix}`, passwordHash: 'x', role } })
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('seeding authz', () => {
  it('unauthenticated is 401; a non-owner non-admin is 403; the owner is 200', async () => {
    const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const owner = await seedUser(suffix, 'sdow', 'ORGANIZER')
    const other = await seedUser(suffix, 'sdot', 'ORGANIZER')
    const ruleset = await prisma.ruleset.create({
      data: { title: `RS ${suffix}`, slug: `rs-sd-${suffix}`, isPublic: true, targetPoints: 3, finalsTargetPoints: 3, createdById: owner.id },
    })
    const tournament = await prisma.tournament.create({
      data: {
        title: `T ${suffix}`, description: '', startDate: new Date(), locationName: 'X',
        postalCode: '10115', city: 'Berlin', state: 'Berlin', latitude: 52.52, longitude: 13.4,
        rulesetId: ruleset.id, createdById: owner.id,
      },
    })
    const ctx = { params: Promise.resolve({ id: tournament.id }) }

    mockAuth.mockResolvedValue(asSession(null))
    expect((await PATCH(patch({ method: 'rating' }), ctx)).status).toBe(401)

    mockAuth.mockResolvedValue(asSession({ id: other.id, name: other.username }))
    expect((await PATCH(patch({ method: 'rating' }), ctx)).status).toBe(403)

    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    expect((await PATCH(patch({ method: 'rating' }), ctx)).status).toBe(200)
  })

  it('manual seeds always win — a rating-based fill never overwrites an already-seeded participant', async () => {
    const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
    const owner = await seedUser(suffix, 'sdmw', 'ORGANIZER')
    const p1 = await seedUser(suffix, 'sdm1')
    const p2 = await seedUser(suffix, 'sdm2')
    const ruleset = await prisma.ruleset.create({
      data: { title: `RS2 ${suffix}`, slug: `rs-sdm-${suffix}`, isPublic: true, targetPoints: 3, finalsTargetPoints: 3, createdById: owner.id },
    })
    const tournament = await prisma.tournament.create({
      data: {
        title: `T2 ${suffix}`, description: '', startDate: new Date(), locationName: 'X',
        postalCode: '10115', city: 'Berlin', state: 'Berlin', latitude: 52.52, longitude: 13.4,
        rulesetId: ruleset.id, createdById: owner.id,
      },
    })
    await prisma.tournamentParticipant.create({ data: { tournamentId: tournament.id, userId: p1.id, seed: 1 } })
    await prisma.tournamentParticipant.create({ data: { tournamentId: tournament.id, userId: p2.id, seed: null } })

    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    const res = await PATCH(patch({ method: 'rating' }), { params: Promise.resolve({ id: tournament.id }) })
    expect(res.status).toBe(200)

    const p1Row = await prisma.tournamentParticipant.findUnique({ where: { tournamentId_userId: { tournamentId: tournament.id, userId: p1.id } } })
    const p2Row = await prisma.tournamentParticipant.findUnique({ where: { tournamentId_userId: { tournamentId: tournament.id, userId: p2.id } } })
    expect(p1Row?.seed).toBe(1) // untouched
    expect(p2Row?.seed).toBe(2) // auto-assigned right after the max manual seed
  })
})
