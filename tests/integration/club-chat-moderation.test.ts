// tests/integration/club-chat-moderation.test.ts
// Phase 12: club-chat message deletion. Integration — CI-only (Postgres/Redis).
// Covers: the author can delete their own message (no AuditLog row); a club owner/admin can
// delete ANY member's message (200) and it writes an AuditLog row (Phase 4 model); a regular
// member deleting someone else's message gets 403; a nonexistent/other-club messageId is 404.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { DELETE, POST } from '@/app/api/clubs/[slug]/messages/route'
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
      name: `ModClub ${suffix}`,
      slug: `modclub-${suffix}`,
      ownerId,
      members: { create: { userId: ownerId, isAdmin: true } },
    },
  })
}

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) })

async function postAs(userId: string, username: string, slug: string, body: string) {
  mockAuth.mockResolvedValue(asSession({ id: userId, name: username }))
  const res = await POST(jsonRequest(`http://localhost/api/clubs/${slug}/messages`, 'POST', { body }), ctx(slug))
  expect(res.status).toBe(201)
  return ((await res.json()) as { message: { id: string } }).message
}

describe('club chat moderation', () => {
  afterEach(() => {
    mockAuth.mockReset()
  })

  it('the author deletes their own message (200, no AuditLog row)', async () => {
    const suffix = Date.now().toString(36)
    const owner = await seedUser(suffix, 'cmodo')
    const club = await seedClub(owner.id, suffix)
    const message = await postAs(owner.id, owner.username, club.slug, 'Meine Nachricht')

    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    const res = await DELETE(jsonRequest(`http://localhost/api/clubs/${club.slug}/messages?messageId=${message.id}`, 'DELETE'), ctx(club.slug))
    expect(res.status).toBe(200)
    expect(await prisma.clubMessage.findUnique({ where: { id: message.id } })).toBeNull()
    expect(await prisma.auditLog.count({ where: { action: 'club.message_remove' } })).toBe(0)

    await prisma.club.delete({ where: { id: club.id } })
    await prisma.user.delete({ where: { id: owner.id } })
  })

  it('club owner deletes another member\'s message (200) and an AuditLog row is written', async () => {
    const suffix = Date.now().toString(36)
    const owner = await seedUser(suffix, 'cmodw')
    const member = await seedUser(suffix, 'cmodm')
    const club = await seedClub(owner.id, suffix)
    await prisma.clubMember.create({ data: { clubId: club.id, userId: member.id, isAdmin: false } })
    const message = await postAs(member.id, member.username, club.slug, 'Zu löschen')

    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    const res = await DELETE(jsonRequest(`http://localhost/api/clubs/${club.slug}/messages?messageId=${message.id}`, 'DELETE'), ctx(club.slug))
    expect(res.status).toBe(200)
    expect(await prisma.clubMessage.findUnique({ where: { id: message.id } })).toBeNull()

    const audit = await prisma.auditLog.findFirst({ where: { action: 'club.message_remove', targetType: 'club_message', targetId: message.id } })
    expect(audit).not.toBeNull()
    expect(audit!.actorId).toBe(owner.id)

    await prisma.club.delete({ where: { id: club.id } })
    await prisma.user.delete({ where: { id: member.id } })
    await prisma.user.delete({ where: { id: owner.id } })
  })

  it('an isAdmin member (not the owner) can also delete any message and it writes AuditLog', async () => {
    const suffix = Date.now().toString(36)
    const owner = await seedUser(suffix, 'cmoda')
    const admin = await seedUser(suffix, 'cmodb')
    const member = await seedUser(suffix, 'cmodc')
    const club = await seedClub(owner.id, suffix)
    await prisma.clubMember.create({ data: { clubId: club.id, userId: admin.id, isAdmin: true } })
    await prisma.clubMember.create({ data: { clubId: club.id, userId: member.id, isAdmin: false } })
    const message = await postAs(member.id, member.username, club.slug, 'Moderiert')

    mockAuth.mockResolvedValue(asSession({ id: admin.id, name: admin.username }))
    const res = await DELETE(jsonRequest(`http://localhost/api/clubs/${club.slug}/messages?messageId=${message.id}`, 'DELETE'), ctx(club.slug))
    expect(res.status).toBe(200)
    expect(await prisma.auditLog.count({ where: { action: 'club.message_remove', targetId: message.id } })).toBe(1)

    await prisma.club.delete({ where: { id: club.id } })
    await prisma.user.delete({ where: { id: member.id } })
    await prisma.user.delete({ where: { id: admin.id } })
    await prisma.user.delete({ where: { id: owner.id } })
  })

  it('a regular member deleting someone else\'s message gets 403 and the row survives', async () => {
    const suffix = Date.now().toString(36)
    const owner = await seedUser(suffix, 'cmodd')
    const author = await seedUser(suffix, 'cmode')
    const member = await seedUser(suffix, 'cmodf')
    const club = await seedClub(owner.id, suffix)
    await prisma.clubMember.create({ data: { clubId: club.id, userId: author.id, isAdmin: false } })
    await prisma.clubMember.create({ data: { clubId: club.id, userId: member.id, isAdmin: false } })
    const message = await postAs(author.id, author.username, club.slug, 'Nicht meine')

    mockAuth.mockResolvedValue(asSession({ id: member.id, name: member.username }))
    const res = await DELETE(jsonRequest(`http://localhost/api/clubs/${club.slug}/messages?messageId=${message.id}`, 'DELETE'), ctx(club.slug))
    expect(res.status).toBe(403)
    expect(await prisma.clubMessage.findUnique({ where: { id: message.id } })).not.toBeNull()
    expect(await prisma.auditLog.count({ where: { action: 'club.message_remove' } })).toBe(0)

    await prisma.club.delete({ where: { id: club.id } })
    await prisma.user.delete({ where: { id: member.id } })
    await prisma.user.delete({ where: { id: author.id } })
    await prisma.user.delete({ where: { id: owner.id } })
  })

  it('a nonexistent or other-club messageId is 404 (existence not leaked); non-member is 403', async () => {
    const suffix = Date.now().toString(36)
    const owner = await seedUser(suffix, 'cmodg')
    const outsider = await seedUser(suffix, 'cmodh')
    const club = await seedClub(owner.id, suffix)
    const message = await postAs(owner.id, owner.username, club.slug, 'Echt')

    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    const missing = await DELETE(jsonRequest(`http://localhost/api/clubs/${club.slug}/messages?messageId=${crypto.randomUUID()}`, 'DELETE'), ctx(club.slug))
    expect(missing.status).toBe(404)

    const otherClub = await prisma.club.create({
      data: { name: `Other ${suffix}`, slug: `other-${suffix}`, ownerId: owner.id, members: { create: { userId: owner.id, isAdmin: true } } },
    })
    const crossClub = await DELETE(jsonRequest(`http://localhost/api/clubs/${otherClub.slug}/messages?messageId=${message.id}`, 'DELETE'), ctx(otherClub.slug))
    expect(crossClub.status).toBe(404)
    expect(await prisma.clubMessage.findUnique({ where: { id: message.id } })).not.toBeNull()

    mockAuth.mockResolvedValue(asSession({ id: outsider.id, name: outsider.username }))
    const asOutsider = await DELETE(jsonRequest(`http://localhost/api/clubs/${club.slug}/messages?messageId=${message.id}`, 'DELETE'), ctx(club.slug))
    expect(asOutsider.status).toBe(403)

    await prisma.club.delete({ where: { id: otherClub.id } })
    await prisma.club.delete({ where: { id: club.id } })
    await prisma.user.delete({ where: { id: outsider.id } })
    await prisma.user.delete({ where: { id: owner.id } })
  })
})
