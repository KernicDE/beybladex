// tests/integration/friendship-flow.test.ts
// Phase 4: the Friendship state machine, end to end against real Postgres (CI-only, never
// run locally per Global Constraints' no-local-Docker rule).
//
// Authorization rules under test (standing Global-Constraints requirement — every rule has a
// negative test):
//   POST   /api/friends            — authenticated only (401 anon); 400 self-request;
//                                    404 unknown addressee; 409 on ANY existing row between
//                                    the pair in EITHER direction (incl. BLOCKED — the
//                                    blocked party cannot re-request).
//   PATCH  /api/friends/:id accept — ONLY the addressee (requester → 403, outsider → 404),
//                                    only from PENDING (else 409).
//   PATCH  /api/friends/:id block  — EITHER party, from PENDING or ACCEPTED (re-block 409).
//   DELETE /api/friends/:id        — EITHER party, ANY status (unfriend / cancel / unblock);
//                                    outsiders 404, anon 401.
// Plus: the Phase 1 privacy gate re-tested with a REAL Friendship.status = ACCEPTED row
// driving isFriend = true through lib/friendship.ts + resolveVisibleFields.
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { POST as FRIENDS_POST } from '@/app/api/friends/route'
import { PATCH as FRIENDS_PATCH, DELETE as FRIENDS_DELETE } from '@/app/api/friends/[id]/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'
import { isFriendWith } from '@/lib/friendship'
import { resolveVisibleFields } from '@/lib/privacy'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

const json = (method: string, body: unknown) =>
  new Request('http://localhost/api/friends', { method, body: JSON.stringify(body) })

describe('Friendship state machine (POST /api/friends, PATCH/DELETE /api/friends/[id])', () => {
  const suffix = Date.now().toString(36)
  const names = {
    a: `fra_${suffix}`, b: `frb_${suffix}`, c: `frc_${suffix}`,
    d: `frd_${suffix}`, e: `fre_${suffix}`, p: `frp_${suffix}`,
  }
  const ids: Record<keyof typeof names, string> = {} as Record<keyof typeof names, string>

  beforeAll(async () => {
    for (const key of Object.keys(names) as (keyof typeof names)[]) {
      const user = await prisma.user.create({ data: { username: names[key], passwordHash: 'x', isMinor: false } })
      ids[key] = user.id
    }
  })

  afterAll(async () => {
    await prisma.friendship.deleteMany({ where: { requesterId: { in: Object.values(ids) } } })
    await prisma.friendship.deleteMany({ where: { addresseeId: { in: Object.values(ids) } } })
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } })
  })

  beforeEach(() => {
    mockAuth.mockResolvedValue(asSession({ id: ids.a, name: names.a }))
  })

  afterEach(() => {
    mockAuth.mockReset()
  })

  it('rejects anonymous requests with 401', async () => {
    mockAuth.mockResolvedValue(asSession(null))
    const res = await FRIENDS_POST(json('POST', { addresseeId: ids.b }))
    expect(res.status).toBe(401)
  })

  it('400s a self-request and an unknown addressee', async () => {
    expect((await FRIENDS_POST(json('POST', { addresseeId: ids.a }))).status).toBe(400)
    expect((await FRIENDS_POST(json('POST', { addresseeId: 'no-such-user' }))).status).toBe(404)
  })

  it('send → PENDING, then duplicate same-direction request 409s', async () => {
    const res = await FRIENDS_POST(json('POST', { addresseeId: ids.b }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.status).toBe('PENDING')
    expect(body.requesterId).toBe(ids.a)
    expect(body.addresseeId).toBe(ids.b)

    const dup = await FRIENDS_POST(json('POST', { addresseeId: ids.b }))
    expect(dup.status).toBe(409)
  })

  it('reverse-direction duplicate 409s too (B requesting A while A→B is pending)', async () => {
    mockAuth.mockResolvedValue(asSession({ id: ids.b, name: names.b }))
    const res = await FRIENDS_POST(json('POST', { addresseeId: ids.a }))
    expect(res.status).toBe(409)
  })

  it('only the addressee can accept; the requester gets 403, an outsider 404', async () => {
    const row = await prisma.friendship.findUnique({
      where: { requesterId_addresseeId: { requesterId: ids.a, addresseeId: ids.b } },
    })

    // requester tries to accept their own outgoing request
    const asRequester = await FRIENDS_PATCH(json('PATCH', { action: 'accept' }), { params: Promise.resolve({ id: row!.id }) })
    expect(asRequester.status).toBe(403)

    // outsider can't even see the row (404, not 403 — no existence leak)
    mockAuth.mockResolvedValue(asSession({ id: ids.c, name: names.c }))
    const asOutsider = await FRIENDS_PATCH(json('PATCH', { action: 'accept' }), { params: Promise.resolve({ id: row!.id }) })
    expect(asOutsider.status).toBe(404)

    // the addressee accepts
    mockAuth.mockResolvedValue(asSession({ id: ids.b, name: names.b }))
    const asAddressee = await FRIENDS_PATCH(json('PATCH', { action: 'accept' }), { params: Promise.resolve({ id: row!.id }) })
    expect(asAddressee.status).toBe(200)
    expect((await asAddressee.json()).status).toBe('ACCEPTED')
  })

  it('accepting an already-ACCEPTED row 409s', async () => {
    mockAuth.mockResolvedValue(asSession({ id: ids.b, name: names.b }))
    const row = await prisma.friendship.findUnique({
      where: { requesterId_addresseeId: { requesterId: ids.a, addresseeId: ids.b } },
    })
    const res = await FRIENDS_PATCH(json('PATCH', { action: 'accept' }), { params: Promise.resolve({ id: row!.id }) })
    expect(res.status).toBe(409)
  })

  it('either party can block an ACCEPTED friendship → BLOCKED', async () => {
    const row = await prisma.friendship.findUnique({
      where: { requesterId_addresseeId: { requesterId: ids.a, addresseeId: ids.b } },
    })
    const res = await FRIENDS_PATCH(json('PATCH', { action: 'block' }), { params: Promise.resolve({ id: row!.id }) })
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('BLOCKED')
  })

  it('the blocked party cannot re-request (409), nor can the other party', async () => {
    mockAuth.mockResolvedValue(asSession({ id: ids.a, name: names.a }))
    expect((await FRIENDS_POST(json('POST', { addresseeId: ids.b }))).status).toBe(409)
    mockAuth.mockResolvedValue(asSession({ id: ids.b, name: names.b }))
    expect((await FRIENDS_POST(json('POST', { addresseeId: ids.a }))).status).toBe(409)
  })

  it('re-blocking a BLOCKED row 409s', async () => {
    const row = await prisma.friendship.findUnique({
      where: { requesterId_addresseeId: { requesterId: ids.a, addresseeId: ids.b } },
    })
    const res = await FRIENDS_PATCH(json('PATCH', { action: 'block' }), { params: Promise.resolve({ id: row!.id }) })
    expect(res.status).toBe(409)
  })

  it('either party can DELETE a BLOCKED row (unblock), outsiders 404, anon 401', async () => {
    const row = await prisma.friendship.findUnique({
      where: { requesterId_addresseeId: { requesterId: ids.a, addresseeId: ids.b } },
    })

    mockAuth.mockResolvedValue(asSession({ id: ids.c, name: names.c }))
    expect((await FRIENDS_DELETE(json('DELETE', {}), { params: Promise.resolve({ id: row!.id }) })).status).toBe(404)

    mockAuth.mockResolvedValue(asSession(null))
    expect((await FRIENDS_DELETE(json('DELETE', {}), { params: Promise.resolve({ id: row!.id }) })).status).toBe(401)

    mockAuth.mockResolvedValue(asSession({ id: ids.b, name: names.b }))
    const res = await FRIENDS_DELETE(json('DELETE', {}), { params: Promise.resolve({ id: row!.id }) })
    expect(res.status).toBe(200)
    expect(await prisma.friendship.findUnique({ where: { id: row!.id } })).toBeNull()
  })

  it('the addressee can reject a PENDING request via DELETE; the requester can cancel theirs', async () => {
    // a→c pending, c declines
    mockAuth.mockResolvedValue(asSession({ id: ids.a, name: names.a }))
    const created = await FRIENDS_POST(json('POST', { addresseeId: ids.c }))
    const row = (await created.json()) as { id: string }
    mockAuth.mockResolvedValue(asSession({ id: ids.c, name: names.c }))
    expect((await FRIENDS_DELETE(json('DELETE', {}), { params: Promise.resolve({ id: row.id }) })).status).toBe(200)

    // d→e pending, d cancels their own outgoing request
    mockAuth.mockResolvedValue(asSession({ id: ids.d, name: names.d }))
    const created2 = await FRIENDS_POST(json('POST', { addresseeId: ids.e }))
    const row2 = (await created2.json()) as { id: string }
    expect((await FRIENDS_DELETE(json('DELETE', {}), { params: Promise.resolve({ id: row2.id }) })).status).toBe(200)
  })

  it('an invalid PATCH action 400s', async () => {
    mockAuth.mockResolvedValue(asSession({ id: ids.a, name: names.a }))
    const created = await FRIENDS_POST(json('POST', { addresseeId: ids.b }))
    const row = (await created.json()) as { id: string }
    const res = await FRIENDS_PATCH(json('PATCH', { action: 'explode' }), { params: Promise.resolve({ id: row.id }) })
    expect(res.status).toBe(400)
    await FRIENDS_DELETE(json('DELETE', {}), { params: Promise.resolve({ id: row.id }) })
  })
})

describe('Privacy gate driven by a real ACCEPTED Friendship row', () => {
  const suffix = `${Date.now().toString(36)}p`
  let viewerId: string
  let subjectId: string

  beforeAll(async () => {
    // subject: minor-ceiling-free adult, city FRIENDS_ONLY, profile PUBLIC
    const subject = await prisma.user.create({
      data: {
        username: `frs_${suffix}`,
        passwordHash: 'x',
        isMinor: false,
        city: 'Berlin',
        locationVisibility: 'FRIENDS_ONLY',
        profileVisibility: 'PUBLIC',
      },
    })
    const viewer = await prisma.user.create({ data: { username: `frv_${suffix}`, passwordHash: 'x', isMinor: false } })
    viewerId = viewer.id
    subjectId = subject.id
  })

  afterAll(async () => {
    await prisma.friendship.deleteMany({ where: { OR: [{ requesterId: viewerId }, { addresseeId: viewerId }] } })
    await prisma.friendship.deleteMany({ where: { OR: [{ requesterId: subjectId }, { addresseeId: subjectId }] } })
    await prisma.user.deleteMany({ where: { id: { in: [viewerId, subjectId] } } })
  })

  it('resolveVisibleFields + isFriendWith: FRIENDS_ONLY city hidden before, visible after accept', async () => {
    const subject = (await prisma.user.findUnique({ where: { id: subjectId } }))!

    // before: no friendship — the FRIENDS_ONLY city is projected away
    const isFriendBefore = await isFriendWith(viewerId, subjectId)
    expect(isFriendBefore).toBe(false)
    const viewBefore = resolveVisibleFields(subject, viewerId, isFriendBefore)
    expect(viewBefore.city).toBeNull()

    // real ACCEPTED row
    const row = await prisma.friendship.create({
      data: { requesterId: viewerId, addresseeId: subjectId, status: 'ACCEPTED' },
    })

    // after: isFriend true in the reverse-request direction too (viewer is addressee here
    // is irrelevant — either direction counts); the city now resolves
    const isFriendAfter = await isFriendWith(viewerId, subjectId)
    expect(isFriendAfter).toBe(true)
    const viewAfter = resolveVisibleFields(subject, viewerId, isFriendAfter)
    expect(viewAfter.city).toBe('Berlin')

    await prisma.friendship.delete({ where: { id: row.id } })
  })

  it('BLOCKED never counts as friendship', async () => {
    const row = await prisma.friendship.create({
      data: { requesterId: viewerId, addresseeId: subjectId, status: 'BLOCKED' },
    })
    expect(await isFriendWith(viewerId, subjectId)).toBe(false)
    expect(await isFriendWith(subjectId, viewerId)).toBe(false)
    await prisma.friendship.delete({ where: { id: row.id } })
  })
})
