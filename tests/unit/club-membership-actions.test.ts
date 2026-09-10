// tests/unit/club-membership-actions.test.ts (RC4, issue #57)
// Direct unit coverage for lib/clubMembershipActions.ts — the extracted club-membership
// business logic (join policies, invite, approve/accept, promote/demote, leave/remove with
// the append-only AuditLog row). The error contract (exact status + token the route maps
// 1:1) and the join-policy matrix are exercised without HTTP via Seam-Mocks on '@/lib/db',
// '@/lib/rateLimit' and '@/lib/notify'. The CI-backed flow matrix lives in
// tests/integration/club-join-policies.test.ts and club-member-status-filter.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const clubFindUnique = vi.fn()
const memberFindFirst = vi.fn()
const memberFindUnique = vi.fn()
const memberCreate = vi.fn()
const memberUpdate = vi.fn()
const memberDelete = vi.fn()
const auditLogCreate = vi.fn()
const userFindUnique = vi.fn()
const rateLimit = vi.fn()
const notifyUser = vi.fn()

const tx = {
  clubMember: { delete: memberDelete },
  user: { findUnique: userFindUnique },
  auditLog: { create: auditLogCreate },
}

vi.mock('@/lib/db', () => ({
  prisma: {
    club: { findUnique: (...a: unknown[]) => clubFindUnique(...a) },
    clubMember: {
      findFirst: (...a: unknown[]) => memberFindFirst(...a),
      findUnique: (...a: unknown[]) => memberFindUnique(...a),
      findMany: vi.fn().mockResolvedValue([]),
      create: (...a: unknown[]) => memberCreate(...a),
      update: (...a: unknown[]) => memberUpdate(...a),
      delete: (...a: unknown[]) => memberDelete(...a),
    },
    user: { findUnique: (...a: unknown[]) => userFindUnique(...a) },
    $transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  },
}))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }))
vi.mock('@/lib/notify', () => ({ notifyUser: (...a: unknown[]) => notifyUser(...a) }))

import { joinClub, inviteToClub, updateMembership, leaveClub, ClubMembershipError } from '@/lib/clubMembershipActions'

const CLUB = { id: 'club-1', ownerId: 'owner-1', name: 'Test Club', slug: 'test-club', joinPolicy: 'OPEN' }

beforeEach(() => {
  vi.clearAllMocks()
  rateLimit.mockResolvedValue({ allowed: true })
  clubFindUnique.mockResolvedValue(CLUB)
})

describe('joinClub (self path, per joinPolicy)', () => {
  it('unknown club → 404 not_found', async () => {
    clubFindUnique.mockResolvedValue(null)
    await expect(joinClub('nope', 'user-1')).rejects.toMatchObject({ status: 404, payload: { error: 'not_found' } })
  })

  it('OPEN joins immediately as ACTIVE (201)', async () => {
    memberCreate.mockResolvedValue({ id: 'm1', isAdmin: false, status: 'ACTIVE' })
    const result = await joinClub('test-club', 'user-1')
    expect(result).toEqual({ status: 201, payload: { id: 'm1', isAdmin: false, status: 'ACTIVE' } })
    expect(memberCreate.mock.calls[0][0].data).toMatchObject({ clubId: 'club-1', userId: 'user-1', status: 'ACTIVE' })
  })

  it('APPLICATION creates PENDING_APPLICATION and notifies the club admins', async () => {
    clubFindUnique.mockResolvedValue({ ...CLUB, joinPolicy: 'APPLICATION' })
    memberCreate.mockResolvedValue({ id: 'm1', isAdmin: false, status: 'PENDING_APPLICATION' })
    userFindUnique.mockResolvedValue({ username: 'applicant' })
    const result = await joinClub('test-club', 'user-1')
    expect(result.status).toBe(201)
    expect(memberCreate.mock.calls[0][0].data.status).toBe('PENDING_APPLICATION')
    expect(notifyUser).toHaveBeenCalledWith('owner-1', expect.objectContaining({ title: 'Neue Bewerbung: Test Club' }))
  })

  it('INVITE_ONLY rejects self-service with 403 join_requires_invite', async () => {
    clubFindUnique.mockResolvedValue({ ...CLUB, joinPolicy: 'INVITE_ONLY' })
    await expect(joinClub('test-club', 'user-1')).rejects.toMatchObject({ status: 403, payload: { error: 'join_requires_invite' } })
    expect(memberCreate).not.toHaveBeenCalled()
  })

  it('duplicate membership (P2002) → 409 already_member; rate limit → 429', async () => {
    memberCreate.mockRejectedValue({ code: 'P2002' })
    await expect(joinClub('test-club', 'user-1')).rejects.toMatchObject({ status: 409, payload: { error: 'already_member' } })
    rateLimit.mockResolvedValue({ allowed: false })
    memberCreate.mockResolvedValue({ id: 'm1', isAdmin: false, status: 'ACTIVE' })
    await expect(joinClub('test-club', 'user-1')).rejects.toMatchObject({ status: 429, payload: { error: 'rate_limited' } })
  })
})

describe('inviteToClub', () => {
  it('a plain ACTIVE member (not admin, not owner) cannot invite → 403', async () => {
    memberFindFirst.mockResolvedValue({ isAdmin: false })
    await expect(inviteToClub('test-club', 'user-1', 'invitee-1')).rejects.toMatchObject({ status: 403, payload: { error: 'forbidden' } })
  })

  it('owner invites: PENDING_INVITE row + invitee notification (201)', async () => {
    memberFindFirst.mockResolvedValue({ isAdmin: false })
    memberCreate.mockResolvedValue({ id: 'm2', status: 'PENDING_INVITE' })
    userFindUnique.mockResolvedValue({ username: 'owner-1' })
    const result = await inviteToClub('test-club', 'owner-1', 'invitee-1')
    expect(result.status).toBe(201)
    expect(memberCreate.mock.calls[0][0].data).toMatchObject({ userId: 'invitee-1', status: 'PENDING_INVITE', isAdmin: false })
    expect(notifyUser).toHaveBeenCalledWith('invitee-1', expect.objectContaining({ title: 'Club-Einladung: Test Club' }))
  })
})

describe('updateMembership', () => {
  const PENDING_APP = { id: 'm1', userId: 'user-1', status: 'PENDING_APPLICATION' }
  const PENDING_INVITE = { id: 'm2', userId: 'invitee-1', status: 'PENDING_INVITE' }

  it('missing target userId → 400 invalid_member; unknown member → 404 not_member', async () => {
    await expect(updateMembership('test-club', 'owner-1', {})).rejects.toMatchObject({ status: 400, payload: { error: 'invalid_member' } })
    memberFindUnique.mockResolvedValue(null)
    await expect(updateMembership('test-club', 'owner-1', { userId: 'ghost' })).rejects.toMatchObject({ status: 404, payload: { error: 'not_member' } })
  })

  it('approve: owner-only gate, PENDING_APPLICATION → ACTIVE + notification', async () => {
    memberFindUnique.mockResolvedValue(PENDING_APP)
    memberUpdate.mockResolvedValue({ userId: 'user-1', status: 'ACTIVE' })
    memberFindFirst.mockResolvedValue({ isAdmin: false })
    // a non-admin, non-owner member may NOT approve
    await expect(updateMembership('test-club', 'user-1', { userId: 'user-1', action: 'approve' }))
      .rejects.toMatchObject({ status: 403, payload: { error: 'forbidden' } })
    const result = await updateMembership('test-club', 'owner-1', { userId: 'user-1', action: 'approve' })
    expect(result).toEqual({ status: 200, payload: { userId: 'user-1', status: 'ACTIVE' } })
    expect(notifyUser).toHaveBeenCalledWith('user-1', expect.objectContaining({ title: 'Bewerbung angenommen: Test Club' }))
  })

  it('approve on a PENDING_INVITE → 409 invalid_transition; unknown action → 400 invalid_action', async () => {
    memberFindUnique.mockResolvedValue(PENDING_INVITE)
    await expect(updateMembership('test-club', 'owner-1', { userId: 'invitee-1', action: 'approve' }))
      .rejects.toMatchObject({ status: 409, payload: { error: 'invalid_transition', status: 'PENDING_INVITE' } })
    await expect(updateMembership('test-club', 'owner-1', { userId: 'invitee-1', action: 'explode' }))
      .rejects.toMatchObject({ status: 400, payload: { error: 'invalid_action' } })
  })

  it('accept: ONLY the invited user (addressee rule) — the inviting admin gets 403', async () => {
    memberFindUnique.mockResolvedValue(PENDING_INVITE)
    await expect(updateMembership('test-club', 'owner-1', { userId: 'invitee-1', action: 'accept' }))
      .rejects.toMatchObject({ status: 403, payload: { error: 'forbidden' } })
    memberUpdate.mockResolvedValue({ userId: 'invitee-1', status: 'ACTIVE' })
    const result = await updateMembership('test-club', 'invitee-1', { userId: 'invitee-1', action: 'accept' })
    expect(result).toEqual({ status: 200, payload: { userId: 'invitee-1', status: 'ACTIVE' } })
  })

  it('promote: owner/ACTIVE-admin only; isAdmin must be a boolean', async () => {
    const ACTIVE = { id: 'm3', userId: 'member-1', status: 'ACTIVE' }
    memberFindUnique.mockResolvedValue(ACTIVE)
    memberFindFirst.mockResolvedValue({ isAdmin: false })
    await expect(updateMembership('test-club', 'user-1', { userId: 'member-1' }))
      .rejects.toMatchObject({ status: 403, payload: { error: 'forbidden' } })
    memberFindFirst.mockResolvedValue({ isAdmin: true })
    await expect(updateMembership('test-club', 'user-1', { userId: 'member-1' }))
      .rejects.toMatchObject({ status: 400, payload: { error: 'invalid_member' } })
    memberUpdate.mockResolvedValue({ userId: 'member-1', isAdmin: true, status: 'ACTIVE' })
    const result = await updateMembership('test-club', 'user-1', { userId: 'member-1', isAdmin: true })
    expect(result).toEqual({ status: 200, payload: { userId: 'member-1', isAdmin: true, status: 'ACTIVE' } })
  })
})

describe('leaveClub', () => {
  it('self-removal always allowed, NO audit row (not an admin action) → 204', async () => {
    memberFindFirst.mockResolvedValue({ isAdmin: false })
    memberFindUnique.mockResolvedValue({ id: 'm1', userId: 'user-1', status: 'ACTIVE' })
    const result = await leaveClub('test-club', 'user-1', 'user-1')
    expect(result).toEqual({ status: 204, payload: null })
    expect(memberDelete).toHaveBeenCalledWith({ where: { id: 'm1' } })
    expect(auditLogCreate).not.toHaveBeenCalled()
  })

  it('removing someone else as a non-admin member → 403', async () => {
    memberFindFirst.mockResolvedValue({ isAdmin: false })
    await expect(leaveClub('test-club', 'user-1', 'member-1')).rejects.toMatchObject({ status: 403, payload: { error: 'forbidden' } })
    expect(memberFindUnique).not.toHaveBeenCalled()
  })

  it('owner removing a member deletes AND writes the append-only AuditLog row', async () => {
    memberFindFirst.mockResolvedValue({ isAdmin: false })
    memberFindUnique.mockResolvedValue({ id: 'm2', userId: 'member-1', status: 'ACTIVE' })
    userFindUnique.mockResolvedValueOnce({ username: 'owner-1' }).mockResolvedValueOnce({ username: 'member-1' })
    const result = await leaveClub('test-club', 'owner-1', 'member-1')
    expect(result.status).toBe(204)
    expect(auditLogCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ actorId: 'owner-1', action: 'club.member_remove', targetId: 'm2' }),
    })
  })
})

describe('ACTIVE-filter single source of truth (issue #61)', () => {
  it('the caller-privilege read is the ACTIVE-filtered lib/clubMembers.ts read — a caller whose only row is PENDING (mocked seam returns null, exactly what the ACTIVE filter does) gets 403 on invite and on promote/demote', async () => {
    memberFindFirst.mockResolvedValue(null) // what getActiveMembership returns for a pending-only caller
    await expect(inviteToClub('test-club', 'user-1', 'invitee-1')).rejects.toMatchObject({ status: 403, payload: { error: 'forbidden' } })
    memberFindUnique.mockResolvedValue({ id: 'm3', userId: 'member-1', status: 'ACTIVE' })
    await expect(updateMembership('test-club', 'user-1', { userId: 'member-1', isAdmin: true }))
      .rejects.toMatchObject({ status: 403, payload: { error: 'forbidden' } })
  })
})

describe('ClubMembershipError contract', () => {
  it('carries status + payload for the route to map 1:1 (204 = null payload)', () => {
    const e = new ClubMembershipError(409, { error: 'already_member' })
    expect(e.status).toBe(409)
    expect(e.payload).toEqual({ error: 'already_member' })
    expect(new ClubMembershipError(204, null).payload).toBeNull()
  })
})
