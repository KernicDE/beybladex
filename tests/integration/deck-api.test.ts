// tests/integration/deck-api.test.ts
// Phase 5 Part A: /api/decks + /api/decks/[id]. Every method is session-required and
// owner-scoped (401 / 404 negative tests per the standing Global-Constraints rule), and the
// no-duplicate-parts deck rule is enforced SERVER-SIDE on create and on build-list
// replacement. CI-only (Postgres/Redis).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { POST } from '@/app/api/decks/route'
import { PATCH } from '@/app/api/decks/[id]/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

const ids = { users: [] as string[], parts: [] as string[], builds: [] as string[], decks: [] as string[] }
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

async function makeBuild(tag: string, bladeName: string) {
  const suffix = Date.now().toString(36)
  const blade = await prisma.part.create({ data: { name: `da_${bladeName}_${suffix}`, category: 'BLADE', manufacturer: 'TT', spinDirection: 'RIGHT' } })
  const ratchet = await prisma.part.create({ data: { name: `da_ratchet_${tag}_${suffix}`, category: 'RATCHET', manufacturer: 'TT', spinDirection: 'RIGHT' } })
  const bit = await prisma.part.create({ data: { name: `da_bit_${tag}_${suffix}`, category: 'BIT', manufacturer: 'TT', spinDirection: 'RIGHT' } })
  ids.parts.push(blade.id, ratchet.id, bit.id)
  const build = await prisma.build.create({ data: { bladeId: blade.id, ratchetId: ratchet.id, bitId: bit.id, type: 'ATTACK' } })
  ids.builds.push(build.id)
  return build
}

async function makeUser(tag: string) {
  const suffix = Date.now().toString(36)
  const user = await prisma.user.create({ data: { username: `da_${tag}_${suffix}`, passwordHash: 'x' } })
  ids.users.push(user.id)
  return user
}

afterEach(() => mockAuth.mockReset())
afterEach(async () => {
  await prisma.deckBuild.deleteMany({ where: { deckId: { in: ids.decks } } })
  for (const id of ids.decks) await prisma.deck.delete({ where: { id } }).catch(() => {})
  for (const id of ids.builds) await prisma.build.delete({ where: { id } }).catch(() => {})
  for (const id of ids.users) await prisma.user.delete({ where: { id } }).catch(() => {})
  for (const id of ids.parts) await prisma.part.delete({ where: { id } }).catch(() => {})
  for (const key of Object.keys(ids)) (ids[key as keyof typeof ids]).length = 0
})

describe('deck API', () => {
  it('POST: 401 unauthenticated; owner comes from the session only', async () => {
    mockAuth.mockResolvedValue(asSession(null))
    expect((await POST(new Request('http://localhost/api/decks', { method: 'POST', body: JSON.stringify({ title: 'X' }) }))).status).toBe(401)
  })

  it('POST rejects a deck reusing the same blade across two builds (server-side deck rule)', async () => {
    const owner = await makeUser('owner')
    // Two builds sharing ONE blade part (distinct ratchets/bits) — the classic violation.
    const suffix = Date.now().toString(36)
    const sharedBlade = await prisma.part.create({ data: { name: `da_shared_${suffix}`, category: 'BLADE', manufacturer: 'TT', spinDirection: 'RIGHT' } })
    ids.parts.push(sharedBlade.id)
    const mk = async (tag: string) => {
      const ratchet = await prisma.part.create({ data: { name: `da_r_${tag}_${suffix}`, category: 'RATCHET', manufacturer: 'TT', spinDirection: 'RIGHT' } })
      const bit = await prisma.part.create({ data: { name: `da_b_${tag}_${suffix}`, category: 'BIT', manufacturer: 'TT', spinDirection: 'RIGHT' } })
      ids.parts.push(ratchet.id, bit.id)
      const build = await prisma.build.create({ data: { bladeId: sharedBlade.id, ratchetId: ratchet.id, bitId: bit.id, type: 'ATTACK' } })
      ids.builds.push(build.id)
      return build.id
    }
    const buildA = await mk('a')
    const buildB = await mk('b')

    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    const res = await POST(new Request('http://localhost/api/decks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Regelverletzung', buildIds: [buildA, buildB] }),
    }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('duplicate_parts')
    expect(await prisma.deck.count({ where: { userId: owner.id } })).toBe(0)
  })

  it('POST a valid deck creates ordered DeckBuild rows; PATCH by a non-owner is 404', async () => {
    const owner = await makeUser('owner2')
    const stranger = await makeUser('stranger')
    const a = await makeBuild('a', 'bladeone')
    const b = await makeBuild('b', 'bladetwo')

    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    const res = await POST(new Request('http://localhost/api/decks', {
      method: 'POST',
      body: JSON.stringify({ title: 'Turnier-Deck', buildIds: [a.id, b.id] }),
    }))
    expect(res.status).toBe(201)
    const { id: deckId } = (await res.json()) as { id: string }
    ids.decks.push(deckId)

    const rows = await prisma.deckBuild.findMany({ where: { deckId }, orderBy: { position: 'asc' } })
    expect(rows.map((r) => [r.position, r.buildId])).toEqual([[1, a.id], [2, b.id]])

    // Non-owner PATCH: 404, deck untouched (existence isn't leaked).
    mockAuth.mockResolvedValue(asSession({ id: stranger.id, name: stranger.username }))
    const forbidden = await PATCH(new Request(`http://localhost/api/decks/${deckId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Gehackt' }),
    }), ctx(deckId))
    expect(forbidden.status).toBe(404)
    expect((await prisma.deck.findUnique({ where: { id: deckId } }))!.title).toBe('Turnier-Deck')

    // Owner PATCH replacing the build list: positions follow the array order.
    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    const swapped = await PATCH(new Request(`http://localhost/api/decks/${deckId}`, {
      method: 'PATCH',
      body: JSON.stringify({ buildIds: [b.id, a.id] }),
    }), ctx(deckId))
    expect(swapped.status).toBe(200)
    const replaced = await prisma.deckBuild.findMany({ where: { deckId }, orderBy: { position: 'asc' } })
    expect(replaced.map((r) => [r.position, r.buildId])).toEqual([[1, b.id], [2, a.id]])
  })
})
