// tests/integration/club-chat-authz.test.ts
// Phase 12: club-chat negative authorization tests (standing Global-Constraints rule). Every
// state-changing/chat route gets 401/403/404 negatives, including the 404-for-nonexistent-club
// existence-leak policy. Also covers the SSE stream route's authz gate (it returns BEFORE any
// Redis subscription, so the negatives are safe to exercise without a subscriber connection).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { DELETE, GET, POST } from '@/app/api/clubs/[slug]/messages/route'
import { GET as STREAM_GET } from '@/app/api/clubs/[slug]/messages/stream/route'
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
      name: `AuthzClub ${suffix}`,
      slug: `authzclub-${suffix}`,
      ownerId,
      members: { create: { userId: ownerId, isAdmin: true } },
    },
  })
}

const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) })
const GHOST = 'kein-club-slug-x'

describe('club chat authz negatives', () => {
  afterEach(() => {
    mockAuth.mockReset()
  })

  it('unauthenticated: 401 on POST, GET, DELETE and the SSE stream', async () => {
    mockAuth.mockResolvedValue(asSession(null))
    const post = await POST(jsonRequest(`http://localhost/api/clubs/${GHOST}/messages`, 'POST', { body: 'hi' }), ctx(GHOST))
    expect(post.status).toBe(401)
    const get = await GET(jsonRequest(`http://localhost/api/clubs/${GHOST}/messages`, 'GET'), ctx(GHOST))
    expect(get.status).toBe(401)
    const del = await DELETE(jsonRequest(`http://localhost/api/clubs/${GHOST}/messages?messageId=${crypto.randomUUID()}`, 'DELETE'), ctx(GHOST))
    expect(del.status).toBe(401)
    const stream = await STREAM_GET(jsonRequest(`http://localhost/api/clubs/${GHOST}/messages/stream`, 'GET'), ctx(GHOST))
    expect(stream.status).toBe(401)
  })

  it('nonexistent club slug: 404 on POST, GET, DELETE and the SSE stream (existence-leak policy)', async () => {
    const suffix = Date.now().toString(36)
    const user = await seedUser(suffix, 'cazo')
    mockAuth.mockResolvedValue(asSession({ id: user.id, name: user.username }))

    const post = await POST(jsonRequest(`http://localhost/api/clubs/${GHOST}/messages`, 'POST', { body: 'hi' }), ctx(GHOST))
    expect(post.status).toBe(404)
    const get = await GET(jsonRequest(`http://localhost/api/clubs/${GHOST}/messages`, 'GET'), ctx(GHOST))
    expect(get.status).toBe(404)
    const del = await DELETE(jsonRequest(`http://localhost/api/clubs/${GHOST}/messages?messageId=${crypto.randomUUID()}`, 'DELETE'), ctx(GHOST))
    expect(del.status).toBe(404)
    const stream = await STREAM_GET(jsonRequest(`http://localhost/api/clubs/${GHOST}/messages/stream`, 'GET'), ctx(GHOST))
    expect(stream.status).toBe(404)

    await prisma.user.delete({ where: { id: user.id } })
  })

  it('non-member: 403 on POST, GET, DELETE and the SSE stream', async () => {
    const suffix = Date.now().toString(36)
    const owner = await seedUser(suffix, 'cazw')
    const outsider = await seedUser(suffix, 'cazx')
    const club = await seedClub(owner.id, suffix)
    mockAuth.mockResolvedValue(asSession({ id: outsider.id, name: outsider.username }))

    const post = await POST(jsonRequest(`http://localhost/api/clubs/${club.slug}/messages`, 'POST', { body: 'hi' }), ctx(club.slug))
    expect(post.status).toBe(403)
    const get = await GET(jsonRequest(`http://localhost/api/clubs/${club.slug}/messages`, 'GET'), ctx(club.slug))
    expect(get.status).toBe(403)
    const del = await DELETE(jsonRequest(`http://localhost/api/clubs/${club.slug}/messages?messageId=${crypto.randomUUID()}`, 'DELETE'), ctx(club.slug))
    expect(del.status).toBe(403)
    const stream = await STREAM_GET(jsonRequest(`http://localhost/api/clubs/${club.slug}/messages/stream`, 'GET'), ctx(club.slug))
    expect(stream.status).toBe(403)

    // No side effects from the rejected attempts.
    expect(await prisma.clubMessage.count({ where: { clubId: club.id } })).toBe(0)

    await prisma.club.delete({ where: { id: club.id } })
    await prisma.user.delete({ where: { id: outsider.id } })
    await prisma.user.delete({ where: { id: owner.id } })
  })

  it('member: 200 on the SSE stream gate is not asserted here (it subscribes) — but GET/POST pass authz', async () => {
    const suffix = Date.now().toString(36)
    const owner = await seedUser(suffix, 'cazy')
    const club = await seedClub(owner.id, suffix)
    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))

    const post = await POST(jsonRequest(`http://localhost/api/clubs/${club.slug}/messages`, 'POST', { body: 'Bin da' }), ctx(club.slug))
    expect(post.status).toBe(201)
    const get = await GET(jsonRequest(`http://localhost/api/clubs/${club.slug}/messages`, 'GET'), ctx(club.slug))
    expect(get.status).toBe(200)
    const { messages } = await get.json()
    expect(messages).toHaveLength(1)

    await prisma.club.delete({ where: { id: club.id } })
    await prisma.user.delete({ where: { id: owner.id } })
  })
})
