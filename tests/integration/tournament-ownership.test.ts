// tests/integration/tournament-ownership.test.ts
// Phase 3: POST /api/tournaments + PATCH/DELETE /api/tournaments/[id]. Integration — CI-only
// (Postgres/Redis). Covers the standing Global-Constraints requirement that every state-changing
// route has a negative authz test: PATCH/DELETE by a non-owner, non-admin ORGANIZER → 403, by the
// owner → 200/204, by an ADMIN → 200/204, unauthenticated → 401.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { POST } from '@/app/api/tournaments/route'
import { PATCH, DELETE } from '@/app/api/tournaments/[id]/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

function post(body: unknown) {
  return new Request('http://localhost/api/tournaments', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

async function seedUser(suffix: string, prefix: string, role: 'USER' | 'ORGANIZER' | 'ADMIN' = 'USER') {
  return prisma.user.create({ data: { username: `${prefix}_${suffix}`, passwordHash: 'x', role } })
}

async function seedTournament(ownerId: string, rulesetId: string, suffix: string) {
  return prisma.tournament.create({
    data: {
      title: `Turnier ${suffix}`,
      description: '',
      startDate: new Date(Date.now() + 7 * 86400_000),
      locationName: 'Spielothek X',
      postalCode: '10115',
      city: 'Berlin',
      state: 'Berlin',
      latitude: 52.52,
      longitude: 13.405,
      rulesetId,
      createdById: ownerId,
    },
  })
}

const VALID_BODY = {
  title: 'DACH-Meisterschaft',
  startDate: new Date(Date.now() + 7 * 86400_000).toISOString(),
  locationName: 'Bey-Arena',
  postalCode: '80331',
  city: 'München',
  state: 'Bayern',
  country: 'DE',
  latitude: 48.137,
  longitude: 11.575,
  entryFeeCent: 500,
  currency: 'EUR',
  rulesetId: 'placeholder',
}

describe('tournament ownership', () => {
  afterEach(() => {
    mockAuth.mockReset()
  })

  it('POST without a session is 401', async () => {
    mockAuth.mockResolvedValue(asSession(null))
    const res = await POST(post(VALID_BODY))
    expect(res.status).toBe(401)
  })

  it('POST as a plain USER role without a clubId is 403 — club admins may only create WITH their own clubId (Phase 4)', async () => {
    const suffix = Date.now().toString(36)
    const user = await seedUser(suffix, 'tpuser')
    const ruleset = await prisma.ruleset.create({ data: { title: `RS ${suffix}`, slug: `rs-${suffix}`, createdById: user.id } })
    mockAuth.mockResolvedValue(asSession({ id: user.id, name: user.username }))

    const res = await POST(post({ ...VALID_BODY, rulesetId: ruleset.id }))
    expect(res.status).toBe(403)

    await prisma.ruleset.delete({ where: { id: ruleset.id } })
    await prisma.user.delete({ where: { id: user.id } })
  })

  it('POST as ORGANIZER creates the tournament with createdById from the session (never the body)', async () => {
    const suffix = Date.now().toString(36)
    const organizer = await seedUser(suffix, 'tporg', 'ORGANIZER')
    const ruleset = await prisma.ruleset.create({ data: { title: `RS ${suffix}`, slug: `rs-${suffix}`, createdById: organizer.id } })
    mockAuth.mockResolvedValue(asSession({ id: organizer.id, name: organizer.username }))

    const res = await POST(post({ ...VALID_BODY, title: `Saisonauftakt ${suffix}`, rulesetId: ruleset.id }))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBeTruthy()

    const row = await prisma.tournament.findUnique({ where: { id: body.id } })
    expect(row).not.toBeNull()
    expect(row!.createdById).toBe(organizer.id)
    expect(row!.clubId).toBeNull()
    expect(row!.entryFeeCent).toBe(500)

    await prisma.tournament.delete({ where: { id: body.id } })
    await prisma.ruleset.delete({ where: { id: ruleset.id } })
    await prisma.user.delete({ where: { id: organizer.id } })
  })

  it('PATCH by a non-owner, non-admin organizer is 403 and leaves the row untouched', async () => {
    const suffix = Date.now().toString(36)
    const owner = await seedUser(suffix, 'tpown', 'ORGANIZER')
    const other = await seedUser(suffix, 'tpoth', 'ORGANIZER')
    const ruleset = await prisma.ruleset.create({ data: { title: `RS ${suffix}`, slug: `rs-${suffix}`, createdById: owner.id } })
    const tournament = await seedTournament(owner.id, ruleset.id, suffix)
    const ctx = { params: Promise.resolve({ id: tournament.id }) }

    mockAuth.mockResolvedValue(asSession({ id: other.id, name: other.username }))
    const res = await PATCH(
      new Request(`http://localhost/api/tournaments/${tournament.id}`, { method: 'PATCH', body: JSON.stringify({ title: 'Übernommen' }) }),
      ctx,
    )
    expect(res.status).toBe(403)

    const row = await prisma.tournament.findUnique({ where: { id: tournament.id } })
    expect(row!.title).toBe(`Turnier ${suffix}`)

    await prisma.tournament.delete({ where: { id: tournament.id } })
    await prisma.ruleset.delete({ where: { id: ruleset.id } })
    await prisma.user.delete({ where: { id: other.id } })
    await prisma.user.delete({ where: { id: owner.id } })
  })

  it('PATCH by the owner is 200 and applies the change', async () => {
    const suffix = Date.now().toString(36)
    const owner = await seedUser(suffix, 'tpown', 'ORGANIZER')
    const ruleset = await prisma.ruleset.create({ data: { title: `RS ${suffix}`, slug: `rs-${suffix}`, createdById: owner.id } })
    const tournament = await seedTournament(owner.id, ruleset.id, suffix)
    const ctx = { params: Promise.resolve({ id: tournament.id }) }

    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    const res = await PATCH(
      new Request(`http://localhost/api/tournaments/${tournament.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: `Turnier ${suffix} (verschoben)`, entryFeeCent: 0, isRecurring: true, recurringDays: 6 }),
      }),
      ctx,
    )
    expect(res.status).toBe(200)

    const row = await prisma.tournament.findUnique({ where: { id: tournament.id } })
    expect(row!.title).toBe(`Turnier ${suffix} (verschoben)`)
    expect(row!.entryFeeCent).toBe(0)
    expect(row!.isRecurring).toBe(true)
    expect(row!.recurringDays).toBe(6)

    await prisma.tournament.delete({ where: { id: tournament.id } })
    await prisma.ruleset.delete({ where: { id: ruleset.id } })
    await prisma.user.delete({ where: { id: owner.id } })
  })

  it('DELETE by a non-owner is 403; DELETE by the owner is 204; an ADMIN can also DELETE', async () => {
    const suffix = Date.now().toString(36)
    const owner = await seedUser(suffix, 'tpown', 'ORGANIZER')
    const other = await seedUser(suffix, 'tpoth', 'ORGANIZER')
    const admin = await seedUser(suffix, 'tpadm', 'ADMIN')
    const ruleset = await prisma.ruleset.create({ data: { title: `RS ${suffix}`, slug: `rs-${suffix}`, createdById: owner.id } })
    const tournament = await seedTournament(owner.id, ruleset.id, suffix)
    const ctx = { params: Promise.resolve({ id: tournament.id }) }

    mockAuth.mockResolvedValue(asSession({ id: other.id, name: other.username }))
    expect((await DELETE(new Request(`http://localhost/api/tournaments/${tournament.id}`, { method: 'DELETE' }), ctx)).status).toBe(403)
    expect(await prisma.tournament.findUnique({ where: { id: tournament.id } })).not.toBeNull()

    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    expect((await DELETE(new Request(`http://localhost/api/tournaments/${tournament.id}`, { method: 'DELETE' }), ctx)).status).toBe(204)
    expect(await prisma.tournament.findUnique({ where: { id: tournament.id } })).toBeNull()

    // ADMIN deletes a second tournament without being its owner
    const second = await seedTournament(owner.id, ruleset.id, `${suffix}b`)
    mockAuth.mockResolvedValue(asSession({ id: admin.id, name: admin.username }))
    expect((await DELETE(new Request(`http://localhost/api/tournaments/${second.id}`, { method: 'DELETE' }), { params: Promise.resolve({ id: second.id }) })).status).toBe(204)

    await prisma.ruleset.delete({ where: { id: ruleset.id } })
    await prisma.user.delete({ where: { id: admin.id } })
    await prisma.user.delete({ where: { id: other.id } })
    await prisma.user.delete({ where: { id: owner.id } })
  })
})
