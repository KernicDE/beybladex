// tests/integration/stage-authz.test.ts
// Phase 5 Part C2 — stage route authorization (standing Global-Constraints rule: every
// state-changing route documents its authz rule and has a negative test). Stage create, stage
// generate, and stage complete are owner/ADMIN-only: a non-owner, non-admin user gets 403 on
// each; an unauthenticated caller gets 401. Integration — CI-only (Postgres/Redis).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { POST as CREATE_STAGE, GET as LIST_STAGES } from '@/app/api/tournaments/[id]/stages/route'
import { POST as GENERATE } from '@/app/api/tournaments/[id]/stages/[stageId]/generate/route'
import { POST as COMPLETE_STAGE } from '@/app/api/tournaments/[id]/stages/[stageId]/complete/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

function req(method: string, url: string, body?: unknown) {
  return new Request(url, { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
}

describe('stage routes authorization', () => {
  afterEach(() => mockAuth.mockReset())

  it('non-owner non-admin gets 403 on stage create/generate/complete; unauthenticated gets 401', async () => {
    const suffix = Date.now().toString(36)
    const owner = await prisma.user.create({ data: { username: `st_own_${suffix}`, passwordHash: 'x', role: 'ORGANIZER' } })
    const intruder = await prisma.user.create({ data: { username: `st_int_${suffix}`, passwordHash: 'x', role: 'JUDGE' } })
    const ruleset = await prisma.ruleset.create({ data: { title: `ST ${suffix}`, slug: `st-${suffix}`, createdById: owner.id } })
    const tournament = await prisma.tournament.create({
      data: {
        title: `ST T ${suffix}`, description: '', startDate: new Date(Date.now() + 86400_000),
        locationName: 'Arena', postalCode: '10115', city: 'Berlin', state: 'Berlin',
        latitude: 52.52, longitude: 13.405, rulesetId: ruleset.id, createdById: owner.id,
      },
    })
    const stage = await prisma.tournamentStage.create({
      data: { tournamentId: tournament.id, order: 1, name: 'Hauptbracket', format: 'SINGLE_ELIMINATION' },
    })

    const base = `http://localhost/api/tournaments/${tournament.id}`
    const ctx = { params: Promise.resolve({ id: tournament.id }) }
    const stageCtx = { params: Promise.resolve({ id: tournament.id, stageId: stage.id }) }

    mockAuth.mockResolvedValue(asSession({ id: intruder.id, name: intruder.username }))
    expect((await CREATE_STAGE(req('POST', `${base}/stages`, { name: 'X', format: 'SWISS', swissRounds: 3 }), ctx)).status).toBe(403)
    expect((await GENERATE(req('POST', `${base}/stages/${stage.id}/generate`), stageCtx)).status).toBe(403)
    expect((await COMPLETE_STAGE(req('POST', `${base}/stages/${stage.id}/complete`), stageCtx)).status).toBe(403)

    mockAuth.mockResolvedValue(asSession(null))
    expect((await CREATE_STAGE(req('POST', `${base}/stages`, { name: 'X', format: 'SWISS', swissRounds: 3 }), ctx)).status).toBe(401)
    expect((await GENERATE(req('POST', `${base}/stages/${stage.id}/generate`), stageCtx)).status).toBe(401)
    expect((await COMPLETE_STAGE(req('POST', `${base}/stages/${stage.id}/complete`), stageCtx)).status).toBe(401)

    // GET stage list is public (the tournament page is a public live surface).
    expect((await LIST_STAGES(req('GET', `${base}/stages`), ctx)).status).toBe(200)

    // A stageId from a DIFFERENT tournament is not_found (404), not a crash.
    const other = await prisma.tournamentStage.create({
      data: { tournamentId: tournament.id, order: 2, name: 'Anderes', format: 'SWISS', swissRounds: 2 },
    })
    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))
    const foreignCtx = { params: Promise.resolve({ id: 'nonexistent-tournament', stageId: stage.id }) }
    expect((await GENERATE(req('POST', `http://localhost/api/tournaments/nonexistent/stages/${stage.id}/generate`), foreignCtx)).status).toBe(404)

    await prisma.tournamentStage.deleteMany({ where: { id: { in: [stage.id, other.id] } } })
    await prisma.tournament.delete({ where: { id: tournament.id } })
    await prisma.ruleset.delete({ where: { id: ruleset.id } })
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, intruder.id] } } })
  })
})
