// tests/integration/collection-privacy.test.ts
// Phase 5 Part B: GET /api/collection privacy gating. A stranger GETting a PRIVATE collection
// gets 404 (existence not leaked — standing not-403 policy); the owner always gets 200; a
// FRIENDS_ONLY collection is 404 for a non-friend and 200 for an ACCEPTED friend
// (lib/friendship.ts semantics). CI-only (Postgres/Redis).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { GET } from '@/app/api/collection/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

const ids = { users: [] as string[], parts: [] as string[], items: [] as string[], friendships: [] as string[] }

async function makeUser(tag: string, collectionVisibility: 'PUBLIC' | 'FRIENDS_ONLY' | 'PRIVATE') {
  const suffix = Date.now().toString(36)
  const user = await prisma.user.create({ data: { username: `cp_${tag}_${suffix}`, passwordHash: 'x', collectionVisibility } })
  ids.users.push(user.id)
  return user
}

async function makePart(tag: string) {
  const suffix = Date.now().toString(36)
  const part = await prisma.part.create({ data: { name: `cp_${tag}_${suffix}`, category: 'BLADE', manufacturer: 'TT', spinDirection: 'RIGHT' } })
  ids.parts.push(part.id)
  return part
}

async function makeItem(userId: string, partId: string) {
  const item = await prisma.collectionItem.create({ data: { userId, partOrBeyId: partId, purchasePrice: 12.99, currency: 'EUR' } })
  ids.items.push(item.id)
  return item
}

function getCollection(username: string) {
  return GET(new Request(`http://localhost/api/collection?user=${username}`))
}

afterEach(() => mockAuth.mockReset())
afterEach(async () => {
  await prisma.pricePoint.deleteMany({ where: { collectionItemId: { in: ids.items } } })
  await prisma.collectionItem.deleteMany({ where: { id: { in: ids.items } } })
  await prisma.friendship.deleteMany({ where: { id: { in: ids.friendships } } })
  for (const id of ids.users) await prisma.user.delete({ where: { id } }).catch(() => {})
  for (const id of ids.parts) await prisma.part.delete({ where: { id } }).catch(() => {})
  for (const key of Object.keys(ids)) (ids[key as keyof typeof ids]).length = 0
})

describe('collection privacy — GET /api/collection?user=', () => {
  it('PRIVATE: stranger (and anonymous) get 404, the owner gets 200', async () => {
    const owner = await makeUser('priv', 'PRIVATE')
    const stranger = await makeUser('stranger', 'PUBLIC')
    await makeItem(owner.id, (await makePart('priv')).id)

    mockAuth.mockResolvedValue(asSession({ id: stranger.id, name: stranger.username }))
    expect((await getCollection(owner.username)).status).toBe(404)

    mockAuth.mockResolvedValue(asSession(null))
    expect((await getCollection(owner.username)).status).toBe(404)

    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    const res = await getCollection(owner.username)
    expect(res.status).toBe(200)
    expect((await res.json()).items).toHaveLength(1)
  })

  it('FRIENDS_ONLY: 404 for a non-friend, 200 for an ACCEPTED friend', async () => {
    const owner = await makeUser('fo', 'FRIENDS_ONLY')
    const friend = await makeUser('friend', 'PUBLIC')
    const nonFriend = await makeUser('nonfriend', 'PUBLIC')
    await makeItem(owner.id, (await makePart('fo')).id)
    const friendship = await prisma.friendship.create({
      data: { requesterId: friend.id, addresseeId: owner.id, status: 'ACCEPTED' },
    })
    ids.friendships.push(friendship.id)

    mockAuth.mockResolvedValue(asSession({ id: nonFriend.id, name: nonFriend.username }))
    expect((await getCollection(owner.username)).status).toBe(404)

    mockAuth.mockResolvedValue(asSession({ id: friend.id, name: friend.username }))
    const res = await getCollection(owner.username)
    expect(res.status).toBe(200)
    expect((await res.json()).items).toHaveLength(1)
  })

  it('PUBLIC: a stranger gets 200; unknown username 404s without leaking why', async () => {
    const owner = await makeUser('pub', 'PUBLIC')
    const stranger = await makeUser('stranger2', 'PUBLIC')
    await makeItem(owner.id, (await makePart('pub')).id)

    mockAuth.mockResolvedValue(asSession({ id: stranger.id, name: stranger.username }))
    expect((await getCollection(owner.username)).status).toBe(200)

    mockAuth.mockResolvedValue(asSession(null))
    expect((await getCollection('gibt_es_nicht')).status).toBe(404)
  })

  it('own collection without ?user: 401 anonymous, 200 owner (always visible to self)', async () => {
    const owner = await makeUser('own', 'PRIVATE')

    mockAuth.mockResolvedValue(asSession(null))
    expect((await GET(new Request('http://localhost/api/collection'))).status).toBe(401)

    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    expect((await GET(new Request('http://localhost/api/collection'))).status).toBe(200)
  })
})
