// tests/integration/club-chat-flow.test.ts
// Phase 12: club chat post/list + the 50-message cap. Integration — CI-only (Postgres/Redis).
// Covers: a member can post (201) and read (200); a non-member gets 403; posting the 51st
// message leaves EXACTLY 50 rows and the oldest is gone (acceptance-critical proof that the
// cap is enforced synchronously in the same transaction as the insert); body validation.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { GET, POST } from '@/app/api/clubs/[slug]/messages/route'
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
      name: `ChatClub ${suffix}`,
      slug: `chatclub-${suffix}`,
      ownerId,
      members: { create: { userId: ownerId, isAdmin: true } },
    },
  })
}

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) })

describe('club chat flow', () => {
  afterEach(() => {
    mockAuth.mockReset()
  })

  it('a member posts a message (201) and reads it back via GET (200)', async () => {
    const suffix = Date.now().toString(36)
    const member = await seedUser(suffix, 'chatm')
    const club = await seedClub(member.id, suffix)
    mockAuth.mockResolvedValue(asSession({ id: member.id, name: member.username }))

    const post = await POST(jsonRequest(`http://localhost/api/clubs/${club.slug}/messages`, 'POST', { body: 'Hallo Club!' }), ctx(club.slug))
    expect(post.status).toBe(201)
    const posted = await post.json()
    expect(posted.message.body).toBe('Hallo Club!')
    expect(posted.message.authorId).toBe(member.id)
    expect(posted.message.authorName).toBe(member.username)

    const list = await GET(jsonRequest(`http://localhost/api/clubs/${club.slug}/messages`, 'GET'), ctx(club.slug))
    expect(list.status).toBe(200)
    const { messages } = await list.json()
    expect(messages).toHaveLength(1)
    expect(messages[0].body).toBe('Hallo Club!')
    expect(messages[0].authorName).toBe(member.username)

    await prisma.club.delete({ where: { id: club.id } })
    await prisma.user.delete({ where: { id: member.id } })
  })

  it('a non-member gets 403 on POST and GET; an unknown slug gets 404', async () => {
    const suffix = Date.now().toString(36)
    const owner = await seedUser(suffix, 'chato')
    const outsider = await seedUser(suffix, 'chatx')
    const club = await seedClub(owner.id, suffix)

    mockAuth.mockResolvedValue(asSession({ id: outsider.id, name: outsider.username }))
    const post = await POST(jsonRequest(`http://localhost/api/clubs/${club.slug}/messages`, 'POST', { body: 'hi' }), ctx(club.slug))
    expect(post.status).toBe(403)
    const get = await GET(jsonRequest(`http://localhost/api/clubs/${club.slug}/messages`, 'GET'), ctx(club.slug))
    expect(get.status).toBe(403)

    // Existence-leak policy: mistyped slug is indistinguishable from a nonexistent club.
    const ghostPost = await POST(jsonRequest('http://localhost/api/clubs/no-such-club-x/messages', 'POST', { body: 'hi' }), ctx('no-such-club-x'))
    expect(ghostPost.status).toBe(404)
    const ghostGet = await GET(jsonRequest('http://localhost/api/clubs/no-such-club-x/messages', 'GET'), ctx('no-such-club-x'))
    expect(ghostGet.status).toBe(404)

    await prisma.club.delete({ where: { id: club.id } })
    await prisma.user.delete({ where: { id: outsider.id } })
    await prisma.user.delete({ where: { id: owner.id } })
  })

  it('posting without a session is 401', async () => {
    mockAuth.mockResolvedValue(asSession(null))
    const res = await POST(jsonRequest('http://localhost/api/clubs/whatever/messages', 'POST', { body: 'hi' }), ctx('whatever'))
    expect(res.status).toBe(401)
  })

  it('rejects an empty or oversized body with 400', async () => {
    const suffix = Date.now().toString(36)
    const member = await seedUser(suffix, 'chatv')
    const club = await seedClub(member.id, suffix)
    mockAuth.mockResolvedValue(asSession({ id: member.id, name: member.username }))

    const empty = await POST(jsonRequest(`http://localhost/api/clubs/${club.slug}/messages`, 'POST', { body: '   ' }), ctx(club.slug))
    expect(empty.status).toBe(400)

    const oversized = await POST(jsonRequest(`http://localhost/api/clubs/${club.slug}/messages`, 'POST', { body: 'x'.repeat(501) }), ctx(club.slug))
    expect(oversized.status).toBe(400)

    const wrongType = await POST(jsonRequest(`http://localhost/api/clubs/${club.slug}/messages`, 'POST', { body: 42 }), ctx(club.slug))
    expect(wrongType.status).toBe(400)

    expect(await prisma.clubMessage.count({ where: { clubId: club.id } })).toBe(0)

    await prisma.club.delete({ where: { id: club.id } })
    await prisma.user.delete({ where: { id: member.id } })
  })

  it('posting the 51st message leaves exactly 50 rows and the oldest is gone', async () => {
    const suffix = Date.now().toString(36)
    const member = await seedUser(suffix, 'chatc')
    const club = await seedClub(member.id, suffix)
    mockAuth.mockResolvedValue(asSession({ id: member.id, name: member.username }))

    for (let i = 1; i <= 50; i++) {
      const res = await POST(jsonRequest(`http://localhost/api/clubs/${club.slug}/messages`, 'POST', { body: `Nachricht ${i}` }), ctx(club.slug))
      expect(res.status).toBe(201)
    }
    expect(await prisma.clubMessage.count({ where: { clubId: club.id } })).toBe(50)

    const res51 = await POST(jsonRequest(`http://localhost/api/clubs/${club.slug}/messages`, 'POST', { body: 'Nachricht 51' }), ctx(club.slug))
    expect(res51.status).toBe(201)

    const rows = await prisma.clubMessage.findMany({ where: { clubId: club.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
    expect(rows).toHaveLength(50) // exactly 50 — the cap held
    expect(rows.some((r) => r.body === 'Nachricht 1')).toBe(false) // oldest deleted
    expect(rows.some((r) => r.body === 'Nachricht 51')).toBe(true) // newest kept

    // GET reflects the same bounded buffer, oldest first.
    const list = await GET(jsonRequest(`http://localhost/api/clubs/${club.slug}/messages`, 'GET'), ctx(club.slug))
    const { messages } = await list.json()
    expect(messages).toHaveLength(50)
    expect(messages[0].body).toBe('Nachricht 2')
    expect(messages[49].body).toBe('Nachricht 51')

    await prisma.club.delete({ where: { id: club.id } })
    await prisma.user.delete({ where: { id: member.id } })
  })

  it('a member flooding past 10 messages/minute is rate-limited (429)', async () => {
    const suffix = Date.now().toString(36)
    const member = await seedUser(suffix, 'chatr')
    const club = await seedClub(member.id, suffix)
    mockAuth.mockResolvedValue(asSession({ id: member.id, name: member.username }))

    // 10/min allowed — the 11th within the same window is 429. The rate limiter needs live
    // Redis; in CI (service containers) this exercises the real Lua limiter.
    let lastStatus = 0
    for (let i = 1; i <= 11; i++) {
      const res = await POST(jsonRequest(`http://localhost/api/clubs/${club.slug}/messages`, 'POST', { body: `Flood ${i}` }), ctx(club.slug))
      lastStatus = res.status
    }
    expect(lastStatus).toBe(429)

    await prisma.club.delete({ where: { id: club.id } })
    await prisma.user.delete({ where: { id: member.id } })
  })
})
