// tests/integration/collection-authz.test.ts
// Phase 5 Part B: CollectionItem mutations are owner-only. 401 unauthenticated; POST creates
// the item for session.user.id and NEVER accepts a userId from the body; PATCH/DELETE (and
// price-point logging) on someone else's item id return 404, not 403 — existence isn't leaked.
// AUTHZ RULE documented per the standing Global-Constraints requirement; these are its
// negative tests. CI-only (Postgres/Redis).
import { describe, it, expect, afterEach, vi } from 'vitest'
import { POST as POST_COLLECTION } from '@/app/api/collection/route'
import { PATCH, DELETE } from '@/app/api/collection/[id]/route'
import { POST as POST_PRICE_POINT } from '@/app/api/collection/[id]/price-points/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

const ids = { users: [] as string[], parts: [] as string[], items: [] as string[], pricePoints: [] as string[] }
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

async function makeUser(tag: string) {
  const suffix = Date.now().toString(36)
  const user = await prisma.user.create({ data: { username: `ca_${tag}_${suffix}`, passwordHash: 'x' } })
  ids.users.push(user.id)
  return user
}

async function makePart(tag: string) {
  const suffix = Date.now().toString(36)
  const part = await prisma.part.create({ data: { name: `ca_${tag}_${suffix}`, category: 'BIT', manufacturer: 'HASBRO', spinDirection: 'RIGHT' } })
  ids.parts.push(part.id)
  return part
}

function jsonReq(url: string, method: string, body: unknown) {
  return new Request(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
}

afterEach(() => mockAuth.mockReset())
afterEach(async () => {
  await prisma.pricePoint.deleteMany({ where: { id: { in: ids.pricePoints } } })
  await prisma.collectionItem.deleteMany({ where: { id: { in: ids.items } } })
  for (const id of ids.users) await prisma.user.delete({ where: { id } }).catch(() => {})
  for (const id of ids.parts) await prisma.part.delete({ where: { id } }).catch(() => {})
  for (const key of Object.keys(ids)) (ids[key as keyof typeof ids]).length = 0
})

describe('collection authz — POST /api/collection', () => {
  it('401 unauthenticated', async () => {
    mockAuth.mockResolvedValue(asSession(null))
    const res = await POST_COLLECTION(jsonReq('http://localhost/api/collection', 'POST', { partId: 'x' }))
    expect(res.status).toBe(401)
  })

  it('creates the item for the session user — a userId in the body is ignored', async () => {
    const owner = await makeUser('owner')
    const other = await makeUser('other')
    const part = await makePart('create')
    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))

    const res = await POST_COLLECTION(
      jsonReq('http://localhost/api/collection', 'POST', {
        partId: part.id, purchasePrice: 9.99, currency: 'CHF', merchant: 'Testshop',
        boughtAt: '2026-08-01', userId: other.id, // must be ignored
      }),
    )
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }
    ids.items.push(id)

    const item = (await prisma.collectionItem.findUnique({ where: { id } }))!
    expect(item.userId).toBe(owner.id)
    expect(item.partOrBeyId).toBe(part.id)
    expect(item.purchasePrice).toBe(9.99)
    expect(item.currency).toBe('CHF')
    expect(item.boughtAt).not.toBeNull()
    // The other user got nothing.
    expect(await prisma.collectionItem.count({ where: { userId: other.id } })).toBe(0)
  })

  it('400 on unknown part, unsupported currency, or malformed body', async () => {
    const owner = await makeUser('bad')
    const part = await makePart('bad')
    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))

    expect((await POST_COLLECTION(jsonReq('http://localhost/api/collection', 'POST', { partId: 'nope' }))).status).toBe(400)
    expect((await POST_COLLECTION(jsonReq('http://localhost/api/collection', 'POST', { partId: part.id, currency: 'JPY' }))).status).toBe(400)
    expect((await POST_COLLECTION(jsonReq('http://localhost/api/collection', 'POST', { purchasePrice: 1 }))).status).toBe(400)
    expect((await POST_COLLECTION(new Request('http://localhost/api/collection', { method: 'POST', body: 'not json' }))).status).toBe(400)
    expect(await prisma.collectionItem.count({ where: { userId: owner.id } })).toBe(0)
  })
})

describe('collection authz — PATCH/DELETE /api/collection/[id]', () => {
  it('PATCH: non-owner gets 404 (existence not leaked), owner can edit', async () => {
    const owner = await makeUser('p_owner')
    const stranger = await makeUser('p_stranger')
    const part = await makePart('patch')
    const item = await prisma.collectionItem.create({ data: { userId: owner.id, partOrBeyId: part.id, purchasePrice: 5, currency: 'EUR' } })
    ids.items.push(item.id)

    mockAuth.mockResolvedValue(asSession(null))
    expect((await PATCH(jsonReq(`http://localhost/api/collection/${item.id}`, 'PATCH', { purchasePrice: 1 }), ctx(item.id))).status).toBe(401)

    mockAuth.mockResolvedValue(asSession({ id: stranger.id, name: stranger.username }))
    expect((await PATCH(jsonReq(`http://localhost/api/collection/${item.id}`, 'PATCH', { purchasePrice: 1 }), ctx(item.id))).status).toBe(404)

    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    expect((await PATCH(jsonReq(`http://localhost/api/collection/${item.id}`, 'PATCH', { purchasePrice: 7.5, currency: 'USD', merchant: null }), ctx(item.id))).status).toBe(200)

    const updated = (await prisma.collectionItem.findUnique({ where: { id: item.id } }))!
    expect(updated.purchasePrice).toBe(7.5)
    expect(updated.currency).toBe('USD')
    expect(updated.merchant).toBeNull()
  })

  it('DELETE: non-owner gets 404 and the item survives; owner deletes and price points cascade', async () => {
    const owner = await makeUser('d_owner')
    const stranger = await makeUser('d_stranger')
    const part = await makePart('delete')
    const item = await prisma.collectionItem.create({ data: { userId: owner.id, partOrBeyId: part.id } })
    ids.items.push(item.id)
    const point = await prisma.pricePoint.create({ data: { collectionItemId: item.id, price: 12, currency: 'EUR' } })
    ids.pricePoints.push(point.id)

    mockAuth.mockResolvedValue(asSession({ id: stranger.id, name: stranger.username }))
    expect((await DELETE(new Request(`http://localhost/api/collection/${item.id}`, { method: 'DELETE' }), ctx(item.id))).status).toBe(404)
    expect(await prisma.collectionItem.findUnique({ where: { id: item.id } })).not.toBeNull()

    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    expect((await DELETE(new Request(`http://localhost/api/collection/${item.id}`, { method: 'DELETE' }), ctx(item.id))).status).toBe(200)
    expect(await prisma.collectionItem.findUnique({ where: { id: item.id } })).toBeNull()
    // Cascade: the price history dies with the item at the DB level.
    expect(await prisma.pricePoint.findUnique({ where: { id: point.id } })).toBeNull()
  })
})

describe('collection authz — POST /api/collection/[id]/price-points', () => {
  it('owner-only: 401 anonymous, 404 non-owner, 201 owner', async () => {
    const owner = await makeUser('pp_owner')
    const stranger = await makeUser('pp_stranger')
    const part = await makePart('pp')
    const item = await prisma.collectionItem.create({ data: { userId: owner.id, partOrBeyId: part.id } })
    ids.items.push(item.id)

    mockAuth.mockResolvedValue(asSession(null))
    expect((await POST_PRICE_POINT(jsonReq(`http://localhost/api/collection/${item.id}/price-points`, 'POST', { price: 15 }), ctx(item.id))).status).toBe(401)

    mockAuth.mockResolvedValue(asSession({ id: stranger.id, name: stranger.username }))
    expect((await POST_PRICE_POINT(jsonReq(`http://localhost/api/collection/${item.id}/price-points`, 'POST', { price: 15 }), ctx(item.id))).status).toBe(404)

    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    const res = await POST_PRICE_POINT(
      jsonReq(`http://localhost/api/collection/${item.id}/price-points`, 'POST', { price: 14.5, currency: 'CHF' }),
      ctx(item.id),
    )
    expect(res.status).toBe(201)
    const points = await prisma.pricePoint.findMany({ where: { collectionItemId: item.id } })
    expect(points).toHaveLength(1)
    expect(points[0]!.price).toBe(14.5)
    expect(points[0]!.currency).toBe('CHF')
    ids.pricePoints.push(points[0]!.id)
  })

  it('400 on missing/zero price or unsupported currency', async () => {
    const owner = await makeUser('pp_bad')
    const part = await makePart('ppbad')
    const item = await prisma.collectionItem.create({ data: { userId: owner.id, partOrBeyId: part.id } })
    ids.items.push(item.id)
    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))

    expect((await POST_PRICE_POINT(jsonReq(`http://localhost/api/collection/${item.id}/price-points`, 'POST', {}), ctx(item.id))).status).toBe(400)
    expect((await POST_PRICE_POINT(jsonReq(`http://localhost/api/collection/${item.id}/price-points`, 'POST', { price: 0 }), ctx(item.id))).status).toBe(400)
    expect((await POST_PRICE_POINT(jsonReq(`http://localhost/api/collection/${item.id}/price-points`, 'POST', { price: 10, currency: 'JPY' }), ctx(item.id))).status).toBe(400)
    expect(await prisma.pricePoint.count({ where: { collectionItemId: item.id } })).toBe(0)
  })
})
