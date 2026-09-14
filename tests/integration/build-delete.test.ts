// tests/integration/build-delete.test.ts (#161)
// DELETE /api/builds/[id] gegen die echte DB: verifiziert die Annahme, auf der die Route
// aufbaut — DeckBuild.buildId ist ON DELETE RESTRICT (prisma/migrations/00000000000000_init),
// ein Build, der noch in einem Deck steckt, kann NICHT gelöscht werden; Prisma wirft P2003,
// die Route übersetzt das zu 409 build_in_use. Ein unbenutzter Build löscht sich normal.
// CI-only (Postgres/Redis).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { DELETE } from '@/app/api/builds/[id]/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

async function makeBuild(tag: string, creatorId: string) {
  const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const blade = await prisma.part.create({ data: { name: `bd_blade_${tag}_${suffix}`, category: 'BLADE', manufacturer: 'TT', spinDirection: 'RIGHT' } })
  const ratchet = await prisma.part.create({ data: { name: `bd_ratchet_${tag}_${suffix}`, category: 'RATCHET', manufacturer: 'TT', spinDirection: 'RIGHT' } })
  const bit = await prisma.part.create({ data: { name: `bd_bit_${tag}_${suffix}`, category: 'BIT', manufacturer: 'TT', spinDirection: 'RIGHT' } })
  const build = await prisma.build.create({ data: { bladeId: blade.id, ratchetId: ratchet.id, bitId: bit.id, type: 'ATTACK', creatorId } })
  return { build, partIds: [blade.id, ratchet.id, bit.id] }
}

afterEach(() => mockAuth.mockReset())

describe('DELETE /api/builds/[id] (#161)', () => {
  it('löscht einen unbenutzten eigenen Build (200)', async () => {
    const suffix = Date.now().toString(36)
    const user = await prisma.user.create({ data: { username: `bd_usr_${suffix}`, passwordHash: 'x' } })
    const { build, partIds } = await makeBuild('free', user.id)
    mockAuth.mockResolvedValue(asSession({ id: user.id, name: user.username }))

    const res = await DELETE(new Request(`http://localhost/api/builds/${build.id}`, { method: 'DELETE' }), ctx(build.id))
    expect(res.status).toBe(200)
    expect(await prisma.build.findUnique({ where: { id: build.id } })).toBeNull()

    await prisma.part.deleteMany({ where: { id: { in: partIds } } })
    await prisma.user.delete({ where: { id: user.id } })
  })

  it('ein Build in einem Deck ist NICHT löschbar — 409 build_in_use, Build bleibt bestehen', async () => {
    const suffix = Date.now().toString(36)
    const user = await prisma.user.create({ data: { username: `bd_usr2_${suffix}`, passwordHash: 'x' } })
    const { build, partIds } = await makeBuild('used', user.id)
    const deck = await prisma.deck.create({ data: { title: `Deck ${suffix}`, userId: user.id } })
    await prisma.deckBuild.create({ data: { deckId: deck.id, buildId: build.id, position: 0 } })
    mockAuth.mockResolvedValue(asSession({ id: user.id, name: user.username }))

    const res = await DELETE(new Request(`http://localhost/api/builds/${build.id}`, { method: 'DELETE' }), ctx(build.id))
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'build_in_use' })
    expect(await prisma.build.findUnique({ where: { id: build.id } })).not.toBeNull()

    await prisma.deckBuild.deleteMany({ where: { deckId: deck.id } })
    await prisma.deck.delete({ where: { id: deck.id } })
    await prisma.build.delete({ where: { id: build.id } })
    await prisma.part.deleteMany({ where: { id: { in: partIds } } })
    await prisma.user.delete({ where: { id: user.id } })
  })

  it('fremder Build → 404, bleibt bestehen', async () => {
    const suffix = Date.now().toString(36)
    const owner = await prisma.user.create({ data: { username: `bd_owner_${suffix}`, passwordHash: 'x' } })
    const other = await prisma.user.create({ data: { username: `bd_other_${suffix}`, passwordHash: 'x' } })
    const { build, partIds } = await makeBuild('foreign', owner.id)
    mockAuth.mockResolvedValue(asSession({ id: other.id, name: other.username }))

    const res = await DELETE(new Request(`http://localhost/api/builds/${build.id}`, { method: 'DELETE' }), ctx(build.id))
    expect(res.status).toBe(404)
    expect(await prisma.build.findUnique({ where: { id: build.id } })).not.toBeNull()

    await prisma.build.delete({ where: { id: build.id } })
    await prisma.part.deleteMany({ where: { id: { in: partIds } } })
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, other.id] } } })
  })
})
