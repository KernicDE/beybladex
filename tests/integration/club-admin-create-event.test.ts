// tests/integration/club-admin-create-event.test.ts
// Phase 4: the corrected POST /api/tournaments authz rule — a ClubMember.isAdmin user WITHOUT
// the global ORGANIZER role can create a tournament for the club they administer (201, clubId
// persisted), but gets 403 for a club they don't administer (the negative-authz proof).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { POST } from '@/app/api/tournaments/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

function post(body: unknown) {
  return new Request('http://localhost/api/tournaments', { method: 'POST', body: JSON.stringify(body) })
}

const VALID_BODY = {
  title: 'Club-Abend',
  startDate: new Date(Date.now() + 7 * 86400_000).toISOString(),
  locationName: 'Clubhaus',
  postalCode: '10115',
  city: 'Berlin',
  state: 'Berlin',
  country: 'DE',
  latitude: 52.52,
  longitude: 13.405,
  entryFeeCent: 0,
  currency: 'EUR',
  rulesetId: 'placeholder',
}

describe('club-admin tournament creation', () => {
  afterEach(() => {
    mockAuth.mockReset()
  })

  it('a ClubMember.isAdmin without the ORGANIZER role can POST a tournament with their clubId (201), and it is persisted', async () => {
    const suffix = Date.now().toString(36)
    const owner = await prisma.user.create({ data: { username: `cae_own_${suffix}`, passwordHash: 'x', role: 'USER' } })
    const club = await prisma.club.create({
      data: { name: `CAE Club ${suffix}`, slug: `cae-club-${suffix}`, ownerId: owner.id, members: { create: { userId: owner.id, isAdmin: true } } },
    })
    const ruleset = await prisma.ruleset.create({ data: { title: `CAE RS ${suffix}`, slug: `cae-rs-${suffix}`, createdById: owner.id } })
    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))

    const res = await POST(post({ ...VALID_BODY, title: `Club-Turnier ${suffix}`, rulesetId: ruleset.id, clubId: club.id }))
    expect(res.status).toBe(201)
    const body = await res.json()

    const row = await prisma.tournament.findUnique({ where: { id: body.id } })
    expect(row).not.toBeNull()
    expect(row!.clubId).toBe(club.id)
    expect(row!.createdById).toBe(owner.id)

    await prisma.tournament.delete({ where: { id: body.id } })
    await prisma.ruleset.delete({ where: { id: ruleset.id } })
    await prisma.club.delete({ where: { id: club.id } })
    await prisma.user.delete({ where: { id: owner.id } })
  })

  it('the same club admin gets 403 for a club they do NOT administer (verified by query, not trusted from the body)', async () => {
    const suffix = Date.now().toString(36)
    const admin = await prisma.user.create({ data: { username: `cae_adm_${suffix}`, passwordHash: 'x', role: 'USER' } })
    const otherOwner = await prisma.user.create({ data: { username: `cae_oth_${suffix}`, passwordHash: 'x', role: 'USER' } })
    const ownClub = await prisma.club.create({
      data: { name: `CAE Own ${suffix}`, slug: `cae-own-${suffix}`, ownerId: admin.id, members: { create: { userId: admin.id, isAdmin: true } } },
    })
    const foreignClub = await prisma.club.create({
      data: { name: `CAE Foreign ${suffix}`, slug: `cae-foreign-${suffix}`, ownerId: otherOwner.id, members: { create: { userId: otherOwner.id, isAdmin: true } } },
    })
    const ruleset = await prisma.ruleset.create({ data: { title: `CAE RS2 ${suffix}`, slug: `cae-rs2-${suffix}`, createdById: otherOwner.id } })
    mockAuth.mockResolvedValue(asSession({ id: admin.id, name: admin.username }))

    const res = await POST(post({ ...VALID_BODY, title: `Fremdes Turnier ${suffix}`, rulesetId: ruleset.id, clubId: foreignClub.id }))
    expect(res.status).toBe(403)

    await prisma.ruleset.delete({ where: { id: ruleset.id } })
    await prisma.club.delete({ where: { id: foreignClub.id } })
    await prisma.club.delete({ where: { id: ownClub.id } })
    await prisma.user.delete({ where: { id: otherOwner.id } })
    await prisma.user.delete({ where: { id: admin.id } })
  })

  it('a clubId that does not exist is 400 even for a global ORGANIZER', async () => {
    const suffix = Date.now().toString(36)
    const organizer = await prisma.user.create({ data: { username: `cae_org_${suffix}`, passwordHash: 'x', role: 'ORGANIZER' } })
    const ruleset = await prisma.ruleset.create({ data: { title: `CAE RS3 ${suffix}`, slug: `cae-rs3-${suffix}`, createdById: organizer.id } })
    mockAuth.mockResolvedValue(asSession({ id: organizer.id, name: organizer.username }))

    const res = await POST(post({ ...VALID_BODY, title: `Ghost ${suffix}`, rulesetId: ruleset.id, clubId: '00000000-0000-0000-0000-000000000000' }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_club')

    await prisma.ruleset.delete({ where: { id: ruleset.id } })
    await prisma.user.delete({ where: { id: organizer.id } })
  })
})
