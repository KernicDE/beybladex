// tests/integration/permission-matrix.test.ts (MVP4/5, #145)
// Die authz-relevanten Zellen des MVP4-Permissions-Modells, die vorher nirgends mit echter DB
// geprüft waren — Konzept #139: „Beyblades anlegen darf nur die Stufe über den Nutzern,
// vorschlagen darf aber jeder angemeldete Nutzer. Teile auch. Builds sind eine Nutzersache."
//   POST /api/admin/builds (erzeugt seit MVP4/1 eine BEYBLADE-Zeile): 401 anonym, 403 USER,
//     TRUSTED erzeugt die Zeile — der direkte Create ist genau so Curator-only wie der
//     CatalogProposal-Approval (den tests/integration/catalog-proposal-flow.test.ts deckt).
//   POST /api/proposals kind=BUILD (der Beyblade-Zweig): jede:r Angemeldete darf ein
//     fehlendes Set vorschlagen — einreichbar als plain USER.
//   PATCH /api/builds/[id]: Ersteller-only inkl. Name/Typ (#145) — ein TRUSTED-Kurator, der
//     nicht Ersteller ist, bekommt denselben 404 wie jede andere Person (kein Kuratoren-
//     Bypass mehr; /api/admin/builds/[id] ist entfernt). Vorbild: build-visibility.test.ts.
//   PATCH /api/decks/[id]: Owner-only ohne Admin-Ausnahme — ein ADMIN, der nicht Owner ist,
//     bekommt 404 (Vorbild: deck-api.test.ts).
// CI-only (Postgres/Redis).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { POST as ADMIN_CREATE_SET } from '@/app/api/admin/builds/route'
import { POST as SUBMIT_PROPOSAL } from '@/app/api/proposals/route'
import { PATCH as PATCH_BUILD } from '@/app/api/builds/[id]/route'
import { PATCH as PATCH_DECK } from '@/app/api/decks/[id]/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

const ids = { users: [] as string[], parts: [] as string[], builds: [] as string[], beyblades: [] as string[], decks: [] as string[], proposals: [] as string[] }

async function makeUser(tag: string, role: 'USER' | 'TRUSTED' | 'ADMIN' = 'USER') {
  const suffix = Date.now().toString(36)
  const user = await prisma.user.create({ data: { username: `pmx_${tag}_${suffix}`, passwordHash: 'x', role } })
  ids.users.push(user.id)
  return user
}

async function makeParts(suffix: string) {
  const blade = await prisma.part.create({ data: { name: `PMX Blade ${suffix}`, category: 'BLADE', manufacturer: 'TT', spinDirection: 'RIGHT' } })
  const ratchet = await prisma.part.create({ data: { name: `PMX Ratchet ${suffix}`, category: 'RATCHET', manufacturer: 'TT', spinDirection: 'RIGHT' } })
  const bit = await prisma.part.create({ data: { name: `PMX Bit ${suffix}`, category: 'BIT', manufacturer: 'TT', spinDirection: 'RIGHT' } })
  ids.parts.push(blade.id, ratchet.id, bit.id)
  return { blade, ratchet, bit }
}

afterEach(() => mockAuth.mockReset())
afterEach(async () => {
  await prisma.catalogProposal.deleteMany({ where: { id: { in: ids.proposals } } })
  await prisma.notification.deleteMany({ where: { userId: { in: ids.users } } })
  await prisma.auditLog.deleteMany({ where: { targetId: { in: [...ids.builds, ...ids.beyblades] } } })
  for (const id of ids.decks) await prisma.deck.delete({ where: { id } }).catch(() => {})
  for (const id of ids.beyblades) await prisma.beyblade.delete({ where: { id } }).catch(() => {})
  for (const id of ids.builds) await prisma.build.delete({ where: { id } }).catch(() => {})
  for (const id of ids.parts) await prisma.part.delete({ where: { id } }).catch(() => {})
  for (const id of ids.users) await prisma.user.delete({ where: { id } }).catch(() => {})
  for (const key of Object.keys(ids)) (ids[key as keyof typeof ids]).length = 0
})

describe('MVP4/5 permission matrix (#145)', () => {
  it('POST /api/admin/builds — Beyblade-Anlegen: 401 anonym, 403 USER, TRUSTED erzeugt die Zeile', async () => {
    const suffix = Date.now().toString(36)
    const user = await makeUser('usr')
    const trusted = await makeUser('trs', 'TRUSTED')
    const parts = await makeParts(suffix)
    const body = JSON.stringify({
      name: `PMX Set ${suffix}`,
      manufacturer: 'TT',
      bladeId: parts.blade.id,
      ratchetId: parts.ratchet.id,
      bitId: parts.bit.id,
    })
    const req = () => new Request('http://localhost/api/admin/builds', { method: 'POST', body })

    mockAuth.mockResolvedValue(asSession(null))
    expect((await ADMIN_CREATE_SET(req())).status).toBe(401)

    mockAuth.mockResolvedValue(asSession({ id: user.id, name: user.username }))
    expect((await ADMIN_CREATE_SET(req())).status).toBe(403)

    mockAuth.mockResolvedValue(asSession({ id: trusted.id, name: trusted.username }))
    const res = await ADMIN_CREATE_SET(req())
    expect(res.status).toBe(201)
    const { id, existing } = (await res.json()) as { id: string; existing: boolean }
    expect(existing).toBe(false)
    ids.beyblades.push(id)
    const beyblade = await prisma.beyblade.findUnique({ where: { id } })
    expect(beyblade?.name).toBe(`PMX Set ${suffix}`)
  })

  it('POST /api/proposals kind=BUILD — der Beyblade-Zweig ist jede:r Angemeldeten offen (plain USER, 201)', async () => {
    const suffix = Date.now().toString(36)
    const submitter = await makeUser('sub')
    const parts = makeParts(suffix)
    void parts // seeded lazily below — parts must exist for the slot references
    const seeded = await makeParts(`${suffix}b`)
    mockAuth.mockResolvedValue(asSession({ id: submitter.id, name: submitter.username }))

    const form = new FormData()
    form.set('kind', 'BUILD')
    form.set('name', `PMX Fehlendes Set ${suffix}`)
    form.set(
      'slots',
      JSON.stringify({
        blade: { partId: seeded.blade.id },
        ratchet: { partId: seeded.ratchet.id },
        bit: { partId: seeded.bit.id },
      }),
    )
    const res = await SUBMIT_PROPOSAL(new Request('http://localhost/api/proposals', { method: 'POST', body: form }))
    expect(res.status).toBe(201)
    const { id } = (await res.json()) as { id: string }
    ids.proposals.push(id)
    const row = await prisma.catalogProposal.findUnique({ where: { id } })
    expect(row?.kind).toBe('BUILD')
    expect(row?.status).toBe('PENDING')
    expect(row?.submittedById).toBe(submitter.id)
  })

  it('PATCH /api/builds/[id] — Ersteller-only inkl. Name/Typ: Kurator, der nicht Ersteller ist, bekommt 404', async () => {
    const suffix = Date.now().toString(36)
    const creator = await makeUser('cre', 'TRUSTED')
    const curator = await makeUser('cur', 'TRUSTED')
    const parts = await makeParts(suffix)
    const build = await prisma.build.create({
      data: {
        bladeId: parts.blade.id,
        ratchetId: parts.ratchet.id,
        bitId: parts.bit.id,
        name: `PMX Build ${suffix}`,
        creatorId: creator.id,
      },
    })
    ids.builds.push(build.id)

    const patch = () =>
      new Request(`http://localhost/api/builds/${build.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: `Umbenannt ${suffix}`, type: 'ATTACK', visibility: 'PUBLIC' }),
      })
    const ctx = { params: Promise.resolve({ id: build.id }) }

    mockAuth.mockResolvedValue(asSession(null))
    expect((await PATCH_BUILD(patch(), ctx)).status).toBe(401)

    // TRUSTED, aber NICHT Ersteller:in — kein Bypass durch die Curator-Stufe (#145).
    mockAuth.mockResolvedValue(asSession({ id: curator.id, name: curator.username }))
    expect((await PATCH_BUILD(patch(), ctx)).status).toBe(404)

    mockAuth.mockResolvedValue(asSession({ id: creator.id, name: creator.username }))
    const res = await PATCH_BUILD(patch(), ctx)
    expect(res.status).toBe(200)
    const row = await prisma.build.findUnique({ where: { id: build.id } })
    expect(row?.name).toBe(`Umbenannt ${suffix}`)
    expect(row?.type).toBe('ATTACK')
    expect(row?.visibility).toBe('PUBLIC')
  })

  it('PATCH /api/decks/[id] — Owner-only ohne Admin-Ausnahme: fremder ADMIN bekommt 404', async () => {
    const owner = await makeUser('own')
    const admin = await makeUser('adm', 'ADMIN')
    const deck = await prisma.deck.create({ data: { title: 'PMX Deck', userId: owner.id } })
    ids.decks.push(deck.id)

    const patch = () =>
      new Request(`http://localhost/api/decks/${deck.id}`, { method: 'PATCH', body: JSON.stringify({ title: 'Gehackt' }) })
    const ctx = { params: Promise.resolve({ id: deck.id }) }

    mockAuth.mockResolvedValue(asSession({ id: admin.id, name: admin.username }))
    expect((await PATCH_DECK(patch(), ctx)).status).toBe(404)

    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    expect((await PATCH_DECK(patch(), ctx)).status).toBe(200)
    const row = await prisma.deck.findUnique({ where: { id: deck.id } })
    expect(row?.title).toBe('Gehackt')
  })
})
