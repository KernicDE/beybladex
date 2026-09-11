// tests/unit/tournament-cache-invalidation.test.ts (hotfix #99)
// PATCH/DELETE /api/tournaments/[id] change exactly what the cached public detail query
// (public:v2:tournament:<id>, app/events/[id]/page.tsx) serves — both must DEL the key after
// the DB write, and only after a SUCCESSFUL one (authz/validation failures must not touch it).
// Seams mocked on '@/...' imports; no DB/Redis involved.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const auth = vi.fn()
const rateLimit = vi.fn()
const authorizeTournamentOrganizer = vi.fn()
const parseTournamentInput = vi.fn()
const tournamentUpdate = vi.fn()
const tournamentDelete = vi.fn()
const transaction = vi.fn()
const invalidatePublicCache = vi.fn()

vi.mock('@/lib/auth', () => ({ auth: (...a: unknown[]) => auth(...a) }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }))
vi.mock('@/lib/tournamentService', () => ({
  authorizeTournamentOrganizer: (...a: unknown[]) => authorizeTournamentOrganizer(...a),
}))
vi.mock('@/lib/tournamentValidation', () => ({
  parseTournamentInput: (...a: unknown[]) => parseTournamentInput(...a),
}))
vi.mock('@/lib/db', () => ({
  prisma: {
    tournament: {
      update: (...a: unknown[]) => tournamentUpdate(...a),
      delete: (...a: unknown[]) => tournamentDelete(...a),
    },
    match: { deleteMany: vi.fn() },
    teamMatch: { deleteMany: vi.fn() },
    teamTournamentEntry: { deleteMany: vi.fn() },
    stageStanding: { deleteMany: vi.fn() },
    tournamentStage: { deleteMany: vi.fn() },
    tournamentParticipant: { deleteMany: vi.fn() },
    $transaction: (...a: unknown[]) => transaction(...a),
  },
}))
// Keep the real key helper (writer/invalidator share it), mock only the DEL. '@/lib/redis' is
// mocked as well so importing the real publicCache module never opens a Redis connection.
vi.mock('@/lib/redis', () => ({ redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))
vi.mock('@/lib/publicCache', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/publicCache')>()
  return { ...actual, invalidatePublicCache: (...a: unknown[]) => invalidatePublicCache(...a) }
})

import { PATCH, DELETE } from '@/app/api/tournaments/[id]/route'

const ID = '1d583a03-e974-49e0-bbb6-d89855aab96e'
const params = Promise.resolve({ id: ID })
const URL = `http://localhost/api/tournaments/${ID}`

function patchReq(body: unknown) {
  return new Request(URL, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  auth.mockResolvedValue({ user: { id: 'organizer-1' } })
  rateLimit.mockResolvedValue({ allowed: true, remaining: 29 })
  authorizeTournamentOrganizer.mockResolvedValue({ error: undefined, tournament: { id: ID, createdById: 'organizer-1' } })
  parseTournamentInput.mockReturnValue({ data: { title: 'BLG x Dortmund eSports' }, errors: [] })
  tournamentUpdate.mockResolvedValue({ id: ID, title: 'BLG x Dortmund eSports', startDate: new Date('2026-09-11T18:00:00Z') })
  transaction.mockResolvedValue([])
  invalidatePublicCache.mockResolvedValue(undefined)
})

describe('PATCH /api/tournaments/[id] (issue #99)', () => {
  it('invalidates the public detail cache after a successful update', async () => {
    const res = await PATCH(patchReq({ title: 'BLG x Dortmund eSports' }), { params })

    expect(res.status).toBe(200)
    expect(tournamentUpdate).toHaveBeenCalledTimes(1)
    expect(invalidatePublicCache).toHaveBeenCalledTimes(1)
    expect(invalidatePublicCache).toHaveBeenCalledWith(`public:v2:tournament:${ID}`)
  })

  it('does NOT invalidate when the organizer check fails', async () => {
    authorizeTournamentOrganizer.mockResolvedValue({ error: Response.json({ error: 'forbidden' }, { status: 403 }) })

    const res = await PATCH(patchReq({ title: 'x' }), { params })

    expect(res.status).toBe(403)
    expect(tournamentUpdate).not.toHaveBeenCalled()
    expect(invalidatePublicCache).not.toHaveBeenCalled()
  })

  it('does NOT invalidate when input validation fails', async () => {
    parseTournamentInput.mockReturnValue({ data: {}, errors: ['invalid_start_date'] })

    const res = await PATCH(patchReq({ startDate: 'gibberish' }), { params })

    expect(res.status).toBe(400)
    expect(tournamentUpdate).not.toHaveBeenCalled()
    expect(invalidatePublicCache).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/tournaments/[id] (issue #99)', () => {
  it('invalidates the public detail cache after a successful delete (no ghost page)', async () => {
    authorizeTournamentOrganizer.mockResolvedValue({
      error: undefined,
      tournament: { id: ID, createdById: 'organizer-1', startedAt: null },
    })

    const res = await DELETE(new Request(URL, { method: 'DELETE' }), { params })

    expect(res.status).toBe(204)
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(invalidatePublicCache).toHaveBeenCalledTimes(1)
    expect(invalidatePublicCache).toHaveBeenCalledWith(`public:v2:tournament:${ID}`)
  })

  it('does NOT invalidate when the tournament was already started', async () => {
    authorizeTournamentOrganizer.mockResolvedValue({
      error: undefined,
      tournament: { id: ID, createdById: 'organizer-1', startedAt: new Date() },
    })

    const res = await DELETE(new Request(URL, { method: 'DELETE' }), { params })

    expect(res.status).toBe(409)
    expect(transaction).not.toHaveBeenCalled()
    expect(invalidatePublicCache).not.toHaveBeenCalled()
  })
})
