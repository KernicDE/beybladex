// tests/integration/club-join-policies.test.ts
// Phase 13: full state-machine proof for all three Club.joinPolicy values, per the plan's
// explicit acceptance criterion. Integration — CI-only (Postgres/Redis).
// Covers: OPEN's unchanged immediate-join behavior; APPLICATION's request -> approve/reject
// cycle; INVITE_ONLY's invite -> accept/decline cycle AND its rejection of self-service POST;
// negative-authz on the club-profile PATCH (joinPolicy change) and on the invite/approve paths.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { POST as JOIN, PATCH, DELETE } from '@/app/api/clubs/[slug]/members/route'
import { PATCH as PATCH_CLUB } from '@/app/api/clubs/[slug]/route'
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

async function seedClub(ownerId: string, suffix: string, joinPolicy: 'OPEN' | 'APPLICATION' | 'INVITE_ONLY' = 'OPEN') {
  return prisma.club.create({
    data: {
      name: `JP Club ${suffix}`,
      slug: `jp-club-${suffix}`,
      ownerId,
      joinPolicy,
      members: { create: { userId: ownerId, isAdmin: true } },
    },
  })
}

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) })

async function cleanup(clubId: string, userIds: string[]) {
  await prisma.club.delete({ where: { id: clubId } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } })
}

describe('club join policies', () => {
  afterEach(() => {
    mockAuth.mockReset()
  })

  it('OPEN: self-service POST creates an ACTIVE row immediately (today\'s pre-Phase-13 behavior, unchanged)', async () => {
    const suffix = Date.now().toString(36)
    const owner = await seedUser(suffix, 'jpoown')
    const joiner = await seedUser(suffix, 'jpojoin')
    const club = await seedClub(owner.id, suffix, 'OPEN')

    mockAuth.mockResolvedValue(asSession({ id: joiner.id, name: joiner.username }))
    const res = await JOIN(jsonRequest(`http://localhost/api/clubs/${club.slug}/members`, 'POST'), ctx(club.slug))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.status).toBe('ACTIVE')

    const row = await prisma.clubMember.findUnique({ where: { clubId_userId: { clubId: club.id, userId: joiner.id } } })
    expect(row?.status).toBe('ACTIVE')

    await cleanup(club.id, [owner.id, joiner.id])
  })

  it('APPLICATION: POST creates PENDING_APPLICATION; owner approves (200, ACTIVE) or an admin rejects (DELETE, row gone)', async () => {
    const suffix = Date.now().toString(36)
    const owner = await seedUser(suffix, 'jpaown')
    const applicant1 = await seedUser(suffix, 'jpaapp1')
    const applicant2 = await seedUser(suffix, 'jpaapp2')
    const club = await seedClub(owner.id, suffix, 'APPLICATION')

    // Apply.
    mockAuth.mockResolvedValue(asSession({ id: applicant1.id, name: applicant1.username }))
    const applyRes = await JOIN(jsonRequest(`http://localhost/api/clubs/${club.slug}/members`, 'POST'), ctx(club.slug))
    expect(applyRes.status).toBe(201)
    expect((await applyRes.json()).status).toBe('PENDING_APPLICATION')

    // A non-admin cannot approve (negative test).
    mockAuth.mockResolvedValue(asSession({ id: applicant2.id, name: applicant2.username }))
    await JOIN(jsonRequest(`http://localhost/api/clubs/${club.slug}/members`, 'POST'), ctx(club.slug)) // applicant2 also applies
    mockAuth.mockResolvedValue(asSession({ id: applicant1.id, name: applicant1.username }))
    const selfApprove = await PATCH(
      jsonRequest(`http://localhost/api/clubs/${club.slug}/members`, 'PATCH', { userId: applicant1.id, action: 'approve' }),
      ctx(club.slug),
    )
    expect(selfApprove.status).toBe(403)

    // Owner approves applicant1 -> ACTIVE.
    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    const approveRes = await PATCH(
      jsonRequest(`http://localhost/api/clubs/${club.slug}/members`, 'PATCH', { userId: applicant1.id, action: 'approve' }),
      ctx(club.slug),
    )
    expect(approveRes.status).toBe(200)
    expect((await approveRes.json()).status).toBe('ACTIVE')

    // A second approve attempt is a 409 invalid_transition (already ACTIVE, not PENDING_APPLICATION).
    const reApprove = await PATCH(
      jsonRequest(`http://localhost/api/clubs/${club.slug}/members`, 'PATCH', { userId: applicant1.id, action: 'approve' }),
      ctx(club.slug),
    )
    expect(reApprove.status).toBe(409)

    // Owner rejects applicant2 by removing the pending row (DELETE).
    const rejectRes = await DELETE(
      jsonRequest(`http://localhost/api/clubs/${club.slug}/members`, 'DELETE', { userId: applicant2.id }),
      ctx(club.slug),
    )
    expect(rejectRes.status).toBe(204)
    expect(await prisma.clubMember.findUnique({ where: { clubId_userId: { clubId: club.id, userId: applicant2.id } } })).toBeNull()

    await cleanup(club.id, [owner.id, applicant1.id, applicant2.id])
  })

  it('INVITE_ONLY: self-service POST is rejected (403 join_requires_invite); a non-admin cannot invite (403); owner invites -> PENDING_INVITE; only the invitee can accept (200) or decline (204)', async () => {
    const suffix = Date.now().toString(36)
    const owner = await seedUser(suffix, 'jpiown')
    const invitee = await seedUser(suffix, 'jpiinv')
    const bystander = await seedUser(suffix, 'jpibys')
    const club = await seedClub(owner.id, suffix, 'INVITE_ONLY')

    // Self-service join is rejected outright.
    mockAuth.mockResolvedValue(asSession({ id: invitee.id, name: invitee.username }))
    const selfJoin = await JOIN(jsonRequest(`http://localhost/api/clubs/${club.slug}/members`, 'POST'), ctx(club.slug))
    expect(selfJoin.status).toBe(403)
    expect((await selfJoin.json()).error).toBe('join_requires_invite')

    // A non-admin, non-owner cannot invite someone else (negative test) — bystander tries to
    // invite invitee before bystander is even a member, so this exercises the plain 403 path.
    mockAuth.mockResolvedValue(asSession({ id: bystander.id, name: bystander.username }))
    const badInvite = await JOIN(
      jsonRequest(`http://localhost/api/clubs/${club.slug}/members`, 'POST', { userId: invitee.id }),
      ctx(club.slug),
    )
    expect(badInvite.status).toBe(403)

    // Owner invites the invitee -> PENDING_INVITE.
    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    const inviteRes = await JOIN(
      jsonRequest(`http://localhost/api/clubs/${club.slug}/members`, 'POST', { userId: invitee.id }),
      ctx(club.slug),
    )
    expect(inviteRes.status).toBe(201)
    expect((await inviteRes.json()).status).toBe('PENDING_INVITE')

    // Someone other than the invitee cannot accept it (mirrors Friendship's addressee rule).
    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    const wrongAccept = await PATCH(
      jsonRequest(`http://localhost/api/clubs/${club.slug}/members`, 'PATCH', { userId: invitee.id, action: 'accept' }),
      ctx(club.slug),
    )
    expect(wrongAccept.status).toBe(403)

    // The invitee accepts -> ACTIVE.
    mockAuth.mockResolvedValue(asSession({ id: invitee.id, name: invitee.username }))
    const acceptRes = await PATCH(
      jsonRequest(`http://localhost/api/clubs/${club.slug}/members`, 'PATCH', { userId: invitee.id, action: 'accept' }),
      ctx(club.slug),
    )
    expect(acceptRes.status).toBe(200)
    expect((await acceptRes.json()).status).toBe('ACTIVE')

    await cleanup(club.id, [owner.id, invitee.id, bystander.id])
  })

  it('INVITE_ONLY decline: the invitee removes their own PENDING_INVITE row via DELETE (204)', async () => {
    const suffix = Date.now().toString(36)
    const owner = await seedUser(suffix, 'jpdown')
    const invitee = await seedUser(suffix, 'jpdinv')
    const club = await seedClub(owner.id, suffix, 'INVITE_ONLY')

    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    await JOIN(jsonRequest(`http://localhost/api/clubs/${club.slug}/members`, 'POST', { userId: invitee.id }), ctx(club.slug))

    mockAuth.mockResolvedValue(asSession({ id: invitee.id, name: invitee.username }))
    const declineRes = await DELETE(
      jsonRequest(`http://localhost/api/clubs/${club.slug}/members`, 'DELETE', { userId: invitee.id }),
      ctx(club.slug),
    )
    expect(declineRes.status).toBe(204)
    expect(await prisma.clubMember.findUnique({ where: { clubId_userId: { clubId: club.id, userId: invitee.id } } })).toBeNull()

    await cleanup(club.id, [owner.id, invitee.id])
  })

  it('PATCH /api/clubs/[slug]: a non-admin cannot change joinPolicy (403); the owner can (200)', async () => {
    const suffix = Date.now().toString(36)
    const owner = await seedUser(suffix, 'jppown')
    const outsider = await seedUser(suffix, 'jppout')
    const club = await seedClub(owner.id, suffix, 'OPEN')

    mockAuth.mockResolvedValue(asSession({ id: outsider.id, name: outsider.username }))
    const forbidden = await PATCH_CLUB(
      jsonRequest(`http://localhost/api/clubs/${club.slug}`, 'PATCH', { joinPolicy: 'APPLICATION' }),
      ctx(club.slug),
    )
    expect(forbidden.status).toBe(403)

    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    const ok = await PATCH_CLUB(
      jsonRequest(`http://localhost/api/clubs/${club.slug}`, 'PATCH', { joinPolicy: 'APPLICATION' }),
      ctx(club.slug),
    )
    expect(ok.status).toBe(200)
    expect((await ok.json()).joinPolicy).toBe('APPLICATION')

    const invalid = await PATCH_CLUB(
      jsonRequest(`http://localhost/api/clubs/${club.slug}`, 'PATCH', { joinPolicy: 'NOT_A_POLICY' }),
      ctx(club.slug),
    )
    expect(invalid.status).toBe(400)

    await cleanup(club.id, [owner.id, outsider.id])
  })
})
