// tests/integration/ruleset-crud.test.ts
// Phase 2: POST /api/rulesets + GET/PATCH /api/rulesets/[slug]. Integration — CI-only
// (Postgres/Redis). Covers the standing Global-Constraints requirement that every
// state-changing route has a negative authz test (PATCH by non-owner → 403) and the
// 404-not-403 private-visibility policy (GET on a private ruleset by a non-owner → 404).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { POST } from '@/app/api/rulesets/route'
import { GET, PATCH } from '@/app/api/rulesets/[slug]/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

function post(body: unknown) {
  return new Request('http://localhost/api/rulesets', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

async function seedUser(suffix: string, prefix = 'rs') {
  return prisma.user.create({ data: { username: `${prefix}_${suffix}`, passwordHash: 'x' } })
}

describe('rulesets CRUD', () => {
  afterEach(() => {
    mockAuth.mockReset()
  })

  it('POST without a session is 401', async () => {
    mockAuth.mockResolvedValue(asSession(null))
    const res = await POST(post({ title: 'Nope' }))
    expect(res.status).toBe(401)
  })

  it('POST creates a ruleset with a URL-safe deterministic slug and createdById from the session', async () => {
    const suffix = Date.now().toString(36)
    const owner = await seedUser(suffix)
    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))

    const res = await POST(post({ title: `Mein Regelwerk ${suffix}` }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.slug).toBe(`mein-regelwerk-${suffix}`)
    expect(body.slug).toMatch(/^[a-z0-9-]+$/)

    const row = await prisma.ruleset.findUnique({ where: { slug: body.slug } })
    expect(row).not.toBeNull()
    expect(row!.createdById).toBe(owner.id)
    // defaults per spec §3
    expect(row!.isPublic).toBe(true)
    expect(row!.deckFormat).toBe('WBO_COUNTERDECK')
    expect(row!.targetPoints).toBe(4)
    expect(row!.finalsTargetPoints).toBe(7)
    expect(row!.externalDisturbanceRerun).toBe(true)

    await prisma.ruleset.delete({ where: { id: row!.id } })
    await prisma.user.delete({ where: { id: owner.id } })
  })

  it('slug collisions get a -2 suffix', async () => {
    const suffix = Date.now().toString(36)
    const owner = await seedUser(suffix)
    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))

    const first = await POST(post({ title: 'Dasselbe Regelwerk' }))
    const second = await POST(post({ title: 'Dasselbe Regelwerk' }))
    expect((await first.json()).slug).toBe('dasselbe-regelwerk')
    expect((await second.json()).slug).toBe('dasselbe-regelwerk-2')

    await prisma.ruleset.deleteMany({ where: { createdById: owner.id } })
    await prisma.user.delete({ where: { id: owner.id } })
  })

  it('PATCH by the owner round-trips every modifier field without loss', async () => {
    const suffix = Date.now().toString(36)
    const owner = await seedUser(suffix)
    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    const created = await POST(post({ title: `Roundtrip ${suffix}` }))
    const { slug } = await created.json()

    const patch = {
      deckFormat: 'PICK_THREE_CHOOSE_ONE',
      targetPoints: 5,
      finalsTargetPoints: 8,
      lockedDecks: false,
      allowForceSwitch: false,
      arenaTurnAllowed: false,
      outOfBounds2Pts: false,
      ownFinishPenalty: false,
      relaunchLimit: 3,
      aerialContactRerun: false,
      externalDisturbanceRerun: false,
      isPublic: false,
      title: `Roundtrip ${suffix} (bearbeitet)`,
      description: 'Geänderte Beschreibung',
    }
    const res = await PATCH(
      new Request(`http://localhost/api/rulesets/${slug}`, { method: 'PATCH', body: JSON.stringify(patch) }),
      { params: Promise.resolve({ slug }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject(patch)

    const row = await prisma.ruleset.findUnique({ where: { slug } })
    expect(row).toMatchObject(patch)

    await prisma.ruleset.delete({ where: { slug } })
    await prisma.user.delete({ where: { id: owner.id } })
  })

  it('PATCH by a non-owner is 403 (negative authz test, standing Global-Constraints rule)', async () => {
    const suffix = Date.now().toString(36)
    const owner = await seedUser(suffix, 'rsown')
    const other = await seedUser(suffix, 'rsoth')
    const ruleset = await prisma.ruleset.create({
      data: { title: `Fremdes Regelwerk ${suffix}`, slug: `fremdes-regelwerk-${suffix}`, createdById: owner.id },
    })

    mockAuth.mockResolvedValue(asSession({ id: other.id, name: other.username }))
    const res = await PATCH(
      new Request(`http://localhost/api/rulesets/${ruleset.slug}`, { method: 'PATCH', body: JSON.stringify({ title: 'Übernommen' }) }),
      { params: Promise.resolve({ slug: ruleset.slug }) },
    )
    expect(res.status).toBe(403)

    // untouched
    const row = await prisma.ruleset.findUnique({ where: { slug: ruleset.slug } })
    expect(row!.title).toBe(`Fremdes Regelwerk ${suffix}`)

    await prisma.ruleset.delete({ where: { id: ruleset.id } })
    await prisma.user.delete({ where: { id: other.id } })
    await prisma.user.delete({ where: { id: owner.id } })
  })

  it('GET on a private ruleset is 404 for a non-owner and for anonymous visitors, 200 for the owner', async () => {
    const suffix = Date.now().toString(36)
    const owner = await seedUser(suffix, 'rspriv')
    const other = await seedUser(suffix, 'rspoth')
    const ruleset = await prisma.ruleset.create({
      data: {
        title: `Privat ${suffix}`,
        slug: `privat-${suffix}`,
        createdById: owner.id,
        isPublic: false,
      },
    })
    const ctx = { params: Promise.resolve({ slug: ruleset.slug }) }

    mockAuth.mockResolvedValue(asSession(null))
    const anon = await GET(new Request(`http://localhost/api/rulesets/${ruleset.slug}`), ctx)
    expect(anon.status).toBe(404) // NOT 403 — existence must not leak

    mockAuth.mockResolvedValue(asSession({ id: other.id, name: other.username }))
    const stranger = await GET(new Request(`http://localhost/api/rulesets/${ruleset.slug}`), ctx)
    expect(stranger.status).toBe(404)

    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    const own = await GET(new Request(`http://localhost/api/rulesets/${ruleset.slug}`), ctx)
    expect(own.status).toBe(200)

    await prisma.ruleset.delete({ where: { id: ruleset.id } })
    await prisma.user.delete({ where: { id: other.id } })
    await prisma.user.delete({ where: { id: owner.id } })
  })

  it('GET on a public ruleset is 200 for anonymous visitors', async () => {
    const suffix = Date.now().toString(36)
    const owner = await seedUser(suffix, 'rspub')
    const ruleset = await prisma.ruleset.create({
      data: { title: `Oeffentlich ${suffix}`, slug: `oeffentlich-${suffix}`, createdById: owner.id, isPublic: true },
    })

    mockAuth.mockResolvedValue(asSession(null))
    const res = await GET(
      new Request(`http://localhost/api/rulesets/${ruleset.slug}`),
      { params: Promise.resolve({ slug: ruleset.slug }) },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.title).toBe(`Oeffentlich ${suffix}`)

    await prisma.ruleset.delete({ where: { id: ruleset.id } })
    await prisma.user.delete({ where: { id: owner.id } })
  })

  it('rejects invalid field values with 400', async () => {
    const suffix = Date.now().toString(36)
    const owner = await seedUser(suffix)
    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))

    const badFormat = await POST(post({ title: `Valid ${suffix}`, deckFormat: 'NOPE' }))
    expect(badFormat.status).toBe(400)
    expect((await badFormat.json()).error).toBe('invalid_deck_format')

    const badPoints = await POST(post({ title: `Valid ${suffix}`, targetPoints: 0 }))
    expect(badPoints.status).toBe(400)
    expect((await badPoints.json()).error).toBe('invalid_points')

    const badRelaunch = await POST(post({ title: `Valid ${suffix}`, relaunchLimit: 99 }))
    expect(badRelaunch.status).toBe(400)
    expect((await badRelaunch.json()).error).toBe('invalid_relaunch_limit')

    const noTitle = await POST(post({}))
    expect(noTitle.status).toBe(400)
    expect((await noTitle.json()).error).toBe('invalid_title')

    // no rows may have been created by any of the rejected requests
    expect(await prisma.ruleset.count({ where: { createdById: owner.id } })).toBe(0)

    await prisma.user.delete({ where: { id: owner.id } })
  })
})
