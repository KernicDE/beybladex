// tests/integration/build-visibility.test.ts (MVP4/4, #144)
// PATCH /api/builds/[id] — Sichtbarkeits-Umschalter (PUBLIC|UNLISTED). AUTHZ: nur die
// ERSTELLERIN bzw. der Ersteller (Build.creatorId) darf toggeln — 401 anonym, 404 für alle
// anderen INKL. Vor-MVP4-Builds ohne Creator (Existenz wird nicht geleakt, standing
// not-403/no-leak-Privacy-Policy). CI-only (Postgres/Redis).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { PATCH } from '@/app/api/builds/[id]/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

const ids = { users: [] as string[], parts: [] as string[], builds: [] as string[] }
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

async function makeBuild(tag: string, creatorId: string | null) {
  const suffix = Date.now().toString(36)
  const blade = await prisma.part.create({ data: { name: `bv_blade_${tag}_${suffix}`, category: 'BLADE', manufacturer: 'TT', spinDirection: 'RIGHT' } })
  const ratchet = await prisma.part.create({ data: { name: `bv_ratchet_${tag}_${suffix}`, category: 'RATCHET', manufacturer: 'TT', spinDirection: 'RIGHT' } })
  const bit = await prisma.part.create({ data: { name: `bv_bit_${tag}_${suffix}`, category: 'BIT', manufacturer: 'TT', spinDirection: 'RIGHT' } })
  ids.parts.push(blade.id, ratchet.id, bit.id)
  const build = await prisma.build.create({ data: { bladeId: blade.id, ratchetId: ratchet.id, bitId: bit.id, type: 'ATTACK', creatorId } })
  ids.builds.push(build.id)
  return build
}

async function makeUser(tag: string) {
  const suffix = Date.now().toString(36)
  const user = await prisma.user.create({ data: { username: `bv_${tag}_${suffix}`, passwordHash: 'x' } })
  ids.users.push(user.id)
  return user
}

afterEach(() => mockAuth.mockReset())
afterEach(async () => {
  for (const id of ids.builds) await prisma.build.delete({ where: { id } }).catch(() => {})
  for (const id of ids.users) await prisma.user.delete({ where: { id } }).catch(() => {})
  for (const id of ids.parts) await prisma.part.delete({ where: { id } }).catch(() => {})
  for (const key of Object.keys(ids)) (ids[key as keyof typeof ids]).length = 0
})

describe('PATCH /api/builds/[id] — Sichtbarkeit (#144)', () => {
  it('creator toggelt PUBLIC ↔ UNLISTED; ungültiger Wert ist 400', async () => {
    const creator = await makeUser('creator')
    const build = await makeBuild('own', creator.id)

    mockAuth.mockResolvedValue(asSession({ id: creator.id, name: creator.username }))
    const invalid = await PATCH(new Request(`http://localhost/api/builds/${build.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ visibility: 'SECRET' }),
    }), ctx(build.id))
    expect(invalid.status).toBe(400)
    expect((await prisma.build.findUnique({ where: { id: build.id } }))!.visibility).toBe('UNLISTED')

    const publicRes = await PATCH(new Request(`http://localhost/api/builds/${build.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ visibility: 'PUBLIC' }),
    }), ctx(build.id))
    expect(publicRes.status).toBe(200)
    expect((await prisma.build.findUnique({ where: { id: build.id } }))!.visibility).toBe('PUBLIC')

    const unlistedRes = await PATCH(new Request(`http://localhost/api/builds/${build.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ visibility: 'UNLISTED' }),
    }), ctx(build.id))
    expect(unlistedRes.status).toBe(200)
    expect((await prisma.build.findUnique({ where: { id: build.id } }))!.visibility).toBe('UNLISTED')
  })

  it('nicht-ersteller:in (auch mit allen Teilen im Besitz) und anonyme bekommen 404/401', async () => {
    const creator = await makeUser('creator2')
    const stranger = await makeUser('stranger')
    const build = await makeBuild('foreign', creator.id)

    mockAuth.mockResolvedValue(asSession({ id: stranger.id, name: stranger.username }))
    expect((await PATCH(new Request(`http://localhost/api/builds/${build.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ visibility: 'PUBLIC' }),
    }), ctx(build.id))).status).toBe(404)
    // Der Build bleibt unverändert (Default UNLISTED).
    expect((await prisma.build.findUnique({ where: { id: build.id } }))!.visibility).toBe('UNLISTED')

    mockAuth.mockResolvedValue(asSession(null))
    expect((await PATCH(new Request(`http://localhost/api/builds/${build.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ visibility: 'PUBLIC' }),
    }), ctx(build.id))).status).toBe(401)
  })

  it('vor-MVP4-Build ohne Creator kann von niemandem getoggelt werden (404)', async () => {
    const user = await makeUser('legacy')
    const build = await makeBuild('legacy', null)

    mockAuth.mockResolvedValue(asSession({ id: user.id, name: user.username }))
    expect((await PATCH(new Request(`http://localhost/api/builds/${build.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ visibility: 'PUBLIC' }),
    }), ctx(build.id))).status).toBe(404)
  })
})
