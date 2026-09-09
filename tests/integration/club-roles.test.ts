// tests/integration/club-roles.test.ts
// Phase 4: POST /api/clubs + /api/clubs/[slug]/members. Integration — CI-only (Postgres/Redis).
// Covers: creator becomes owner AND isAdmin ClubMember in one transaction; any authenticated
// user can join (isAdmin:false); promote/demote is owner/admin-only (403 negative test);
// kick — non-admin removing someone else is 403, self-leave is 204, admin kick is 204 and
// writes an AuditLog row; duplicate join is 409 (the @@unique([clubId, userId]) constraint,
// not an application check).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { POST as POST_CLUB } from '@/app/api/clubs/route'
import { POST as JOIN, PATCH, DELETE } from '@/app/api/clubs/[slug]/members/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

function jsonRequest(url: string, method: string, body?: unknown) {
  return new Request(url, { method, body: body === undefined ? null : JSON.stringify(body) })
}

async function seedUser(suffix: string, prefix: string) {
  return prisma.user.create({ data: { username: `${prefix}_${suffix}`, passwordHash: 'x', role: 'USER' } })
}

async function seedClub(ownerId: string, suffix: string) {
  return prisma.club.create({
    data: {
      name: `Club ${suffix}`,
      slug: `club-${suffix}`,
      ownerId,
      members: { create: { userId: ownerId, isAdmin: true } },
    },
  })
}

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) })

describe('club roles', () => {
  afterEach(() => {
    mockAuth.mockReset()
  })

  it('POST /api/clubs creates the club AND an isAdmin=true ClubMember for the creator (owner) in one transaction', async () => {
    const suffix = Date.now().toString(36)
    const owner = await seedUser(suffix, 'crown')
    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))

    const res = await POST_CLUB(jsonRequest('http://localhost/api/clubs', 'POST', { name: `Bey-Bund ${suffix}`, description: 'Testclub' }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.slug).toBeTruthy()

    const club = await prisma.club.findUnique({ where: { id: body.id }, include: { members: true } })
    expect(club).not.toBeNull()
    expect(club!.ownerId).toBe(owner.id)
    expect(club!.members).toHaveLength(1)
    expect(club!.members[0].userId).toBe(owner.id)
    expect(club!.members[0].isAdmin).toBe(true)

    await prisma.club.delete({ where: { id: body.id } })
    await prisma.user.delete({ where: { id: owner.id } })
  })

  it('POST without a session is 401', async () => {
    mockAuth.mockResolvedValue(asSession(null))
    const res = await POST_CLUB(jsonRequest('http://localhost/api/clubs', 'POST', { name: 'X' }))
    expect(res.status).toBe(401)
  })

  it('join creates an isAdmin:false membership; a duplicate join is 409 via the @@unique constraint', async () => {
    const suffix = Date.now().toString(36)
    const owner = await seedUser(suffix, 'cjown')
    const joiner = await seedUser(suffix, 'cjmem')
    const club = await seedClub(owner.id, suffix)

    mockAuth.mockResolvedValue(asSession({ id: joiner.id, name: joiner.username }))
    const res = await JOIN(jsonRequest(`http://localhost/api/clubs/${club.slug}/members`, 'POST'), ctx(club.slug))
    expect(res.status).toBe(201)
    const membership = await prisma.clubMember.findUnique({ where: { clubId_userId: { clubId: club.id, userId: joiner.id } } })
    expect(membership?.isAdmin).toBe(false)

    // Duplicate join: the DB constraint turns this into 409 (constraint proof).
    const dup = await JOIN(jsonRequest(`http://localhost/api/clubs/${club.slug}/members`, 'POST'), ctx(club.slug))
    expect(dup.status).toBe(409)
    expect((await dup.json()).error).toBe('already_member')

    await prisma.club.delete({ where: { id: club.id } })
    await prisma.user.delete({ where: { id: joiner.id } })
    await prisma.user.delete({ where: { id: owner.id } })
  })

  it('PATCH promote/demote: a non-admin member gets 403; the owner gets 200; an isAdmin member gets 200', async () => {
    const suffix = Date.now().toString(36)
    const owner = await seedUser(suffix, 'cpown')
    const admin = await seedUser(suffix, 'cpadm')
    const member = await seedUser(suffix, 'cpmem')
    const club = await seedClub(owner.id, suffix)
    await prisma.clubMember.createMany({
      data: [
        { clubId: club.id, userId: admin.id, isAdmin: true },
        { clubId: club.id, userId: member.id, isAdmin: false },
      ],
    })

    // Non-admin member tries to promote themselves — 403 (the standing negative-authz test).
    mockAuth.mockResolvedValue(asSession({ id: member.id, name: member.username }))
    const forbidden = await PATCH(
      jsonRequest(`http://localhost/api/clubs/${club.slug}/members`, 'PATCH', { userId: member.id, isAdmin: true }),
      ctx(club.slug),
    )
    expect(forbidden.status).toBe(403)
    expect((await prisma.clubMember.findUnique({ where: { clubId_userId: { clubId: club.id, userId: member.id } } }))!.isAdmin).toBe(false)

    // Owner promotes the plain member — 200.
    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    const byOwner = await PATCH(
      jsonRequest(`http://localhost/api/clubs/${club.slug}/members`, 'PATCH', { userId: member.id, isAdmin: true }),
      ctx(club.slug),
    )
    expect(byOwner.status).toBe(200)

    // An isAdmin member demotes them again — 200.
    mockAuth.mockResolvedValue(asSession({ id: admin.id, name: admin.username }))
    const byAdmin = await PATCH(
      jsonRequest(`http://localhost/api/clubs/${club.slug}/members`, 'PATCH', { userId: member.id, isAdmin: false }),
      ctx(club.slug),
    )
    expect(byAdmin.status).toBe(200)
    expect((await prisma.clubMember.findUnique({ where: { clubId_userId: { clubId: club.id, userId: member.id } } }))!.isAdmin).toBe(false)

    await prisma.club.delete({ where: { id: club.id } })
    await prisma.user.delete({ where: { id: member.id } })
    await prisma.user.delete({ where: { id: admin.id } })
    await prisma.user.delete({ where: { id: owner.id } })
  })

  it('DELETE: a non-admin cannot remove someone else (403); self-leave is 204; an admin kick is 204 and writes an AuditLog row', async () => {
    const suffix = Date.now().toString(36)
    const owner = await seedUser(suffix, 'ckown')
    const admin = await seedUser(suffix, 'ckadm')
    const member = await seedUser(suffix, 'ckmem')
    const club = await seedClub(owner.id, suffix)
    const adminMembership = await prisma.clubMember.create({ data: { clubId: club.id, userId: admin.id, isAdmin: true } })
    const memberMembership = await prisma.clubMember.create({ data: { clubId: club.id, userId: member.id, isAdmin: false } })

    // Non-admin tries to kick the admin — 403, nothing removed.
    mockAuth.mockResolvedValue(asSession({ id: member.id, name: member.username }))
    const forbidden = await DELETE(
      jsonRequest(`http://localhost/api/clubs/${club.slug}/members`, 'DELETE', { userId: admin.id }),
      ctx(club.slug),
    )
    expect(forbidden.status).toBe(403)
    expect(await prisma.clubMember.findUnique({ where: { id: adminMembership.id } })).not.toBeNull()

    // The admin kicks the member — 204, row gone, AuditLog entry written.
    mockAuth.mockResolvedValue(asSession({ id: admin.id, name: admin.username }))
    const kicked = await DELETE(
      jsonRequest(`http://localhost/api/clubs/${club.slug}/members`, 'DELETE', { userId: member.id }),
      ctx(club.slug),
    )
    expect(kicked.status).toBe(204)
    expect(await prisma.clubMember.findUnique({ where: { id: memberMembership.id } })).toBeNull()
    const audit = await prisma.auditLog.findFirst({ where: { action: 'club.member_remove', targetId: memberMembership.id } })
    expect(audit).not.toBeNull()
    expect(audit!.actorId).toBe(admin.id)
    await prisma.auditLog.delete({ where: { id: audit!.id } })

    // Self-leave: the admin removes themselves — 204.
    mockAuth.mockResolvedValue(asSession({ id: admin.id, name: admin.username }))
    const selfLeave = await DELETE(
      jsonRequest(`http://localhost/api/clubs/${club.slug}/members`, 'DELETE', { userId: admin.id }),
      ctx(club.slug),
    )
    expect(selfLeave.status).toBe(204)
    // A self-leave is not an admin action — no audit row for it.
    expect(await prisma.auditLog.findFirst({ where: { action: 'club.member_remove', actorId: admin.id } })).toBeNull()

    await prisma.club.delete({ where: { id: club.id } })
    await prisma.user.delete({ where: { id: member.id } })
    await prisma.user.delete({ where: { id: admin.id } })
    await prisma.user.delete({ where: { id: owner.id } })
  })
})
