// tests/integration/build-ratings.test.ts
// Phase 5 Part A: /api/builds/[id]/ratings. A second rating from the same user UPSERTS rather
// than duplicates (@@unique([buildId, userId])); a non-owner cannot PATCH/DELETE another
// user's rating (403/404); a TRUSTED user can moderate-remove any rating and it writes an
// append-only AuditLog row. CI-only (Postgres/Redis).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { GET, POST, PATCH, DELETE } from '@/app/api/builds/[id]/ratings/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

const ids = { users: [] as string[], parts: [] as string[], builds: [] as string[], ratings: [] as string[] }
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

async function makeBuild() {
  const suffix = Date.now().toString(36)
  const blade = await prisma.part.create({ data: { name: `br_blade_${suffix}`, category: 'BLADE', manufacturer: 'TT', spinDirection: 'RIGHT' } })
  const ratchet = await prisma.part.create({ data: { name: `br_ratchet_${suffix}`, category: 'RATCHET', manufacturer: 'TT', spinDirection: 'RIGHT' } })
  const bit = await prisma.part.create({ data: { name: `br_bit_${suffix}`, category: 'BIT', manufacturer: 'TT', spinDirection: 'RIGHT' } })
  ids.parts.push(blade.id, ratchet.id, bit.id)
  const build = await prisma.build.create({ data: { bladeId: blade.id, ratchetId: ratchet.id, bitId: bit.id, type: 'ATTACK' } })
  ids.builds.push(build.id)
  return build
}

async function makeUser(tag: string, role: 'USER' | 'TRUSTED' | 'ADMIN' = 'USER') {
  const suffix = Date.now().toString(36)
  const user = await prisma.user.create({ data: { username: `br_${tag}_${suffix}`, passwordHash: 'x', role } })
  ids.users.push(user.id)
  return user
}

function postRating(buildId: string, stars: number, comment: string | null) {
  return new Request(`http://localhost/api/builds/${buildId}/ratings`, {
    method: 'POST',
    body: JSON.stringify({ stars, comment }),
  })
}

afterEach(() => mockAuth.mockReset())
afterEach(async () => {
  await prisma.auditLog.deleteMany({ where: { action: 'rating.moderate_remove', targetId: { in: ids.ratings } } })
  for (const id of ids.ratings) await prisma.rating.delete({ where: { id } }).catch(() => {})
  for (const id of ids.builds) await prisma.build.delete({ where: { id } }).catch(() => {})
  for (const id of ids.users) await prisma.user.delete({ where: { id } }).catch(() => {})
  for (const id of ids.parts) await prisma.part.delete({ where: { id } }).catch(() => {})
  for (const key of Object.keys(ids)) (ids[key as keyof typeof ids]).length = 0
})

describe('build ratings', () => {
  it('a second rating from the same user upserts (edits) instead of duplicating', async () => {
    const build = await makeBuild()
    const user = await makeUser('owner')
    mockAuth.mockResolvedValue(asSession({ id: user.id, name: user.username }))

    expect((await POST(postRating(build.id, 4, null), ctx(build.id))).status).toBe(201)
    expect((await POST(postRating(build.id, 5, 'Spielt sich toll'), ctx(build.id))).status).toBe(201)

    const ratings = await prisma.rating.findMany({ where: { buildId: build.id, userId: user.id } })
    expect(ratings).toHaveLength(1)
    expect(ratings[0].stars).toBe(5)
    expect(ratings[0].comment).toBe('Spielt sich toll')

    const list = await GET(new Request(`http://localhost/api/builds/${build.id}/ratings`), ctx(build.id))
    expect((await list.json()).ratings).toHaveLength(1)
    ids.ratings.push(ratings[0].id)
  })

  it('a non-owner cannot PATCH or DELETE another user\'s rating', async () => {
    const build = await makeBuild()
    const owner = await makeUser('r_owner')
    const stranger = await makeUser('r_stranger')
    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    await POST(postRating(build.id, 3, 'Meine Meinung'), ctx(build.id))
    const rating = (await prisma.rating.findFirst({ where: { buildId: build.id } }))!
    ids.ratings.push(rating.id)

    mockAuth.mockResolvedValue(asSession({ id: stranger.id, name: stranger.username }))
    const patch = await PATCH(
      new Request(`http://localhost/api/builds/${build.id}/ratings?ratingId=${rating.id}`, { method: 'PATCH', body: JSON.stringify({ stars: 1 }) }),
      ctx(build.id),
    )
    expect(patch.status).toBe(403)
    const del = await DELETE(
      new Request(`http://localhost/api/builds/${build.id}/ratings?ratingId=${rating.id}`, { method: 'DELETE' }),
      ctx(build.id),
    )
    expect(del.status).toBe(403)

    const untouched = await prisma.rating.findUnique({ where: { id: rating.id } })
    expect(untouched!.stars).toBe(3)
  })

  it('a TRUSTED user can moderate-remove any rating, and it writes an AuditLog row', async () => {
    const build = await makeBuild()
    const owner = await makeUser('m_owner')
    const trusted = await makeUser('m_trusted', 'TRUSTED')
    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    await POST(postRating(build.id, 2, 'anstößiger Testkommentar'), ctx(build.id))
    const rating = (await prisma.rating.findFirst({ where: { buildId: build.id } }))!
    ids.ratings.push(rating.id)

    mockAuth.mockResolvedValue(asSession({ id: trusted.id, name: trusted.username }))
    const res = await DELETE(
      new Request(`http://localhost/api/builds/${build.id}/ratings?ratingId=${rating.id}`, { method: 'DELETE' }),
      ctx(build.id),
    )
    expect(res.status).toBe(200)
    expect(await prisma.rating.findUnique({ where: { id: rating.id } })).toBeNull()

    const audit = await prisma.auditLog.findFirst({ where: { action: 'rating.moderate_remove', targetId: rating.id } })
    expect(audit).not.toBeNull()
    expect(audit!.actorId).toBe(trusted.id)
    expect(audit!.targetType).toBe('rating')
  })
})
