// tests/unit/build-delete.test.ts (#161)
// DELETE /api/builds/[id] — dieselbe Ersteller-only-Prüfung wie PATCH (404 für alle anderen,
// kein Leak). Steckt der Build noch in einem Deck (DeckBuild.buildId ON DELETE RESTRICT),
// wirft Prisma P2003 — die Route übersetzt das zu 409 build_in_use statt eines rohen 500.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'

const { authMock, buildFindUnique, buildDelete } = vi.hoisted(() => ({
  authMock: vi.fn(),
  buildFindUnique: vi.fn(),
  buildDelete: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: authMock }))
vi.mock('@/lib/db', () => ({
  prisma: { build: { findUnique: buildFindUnique, delete: buildDelete } },
}))

import { DELETE } from '@/app/api/builds/[id]/route'

function asSession(id: string | null) {
  return id === null
    ? null
    : ({ user: { id, name: id }, expires: new Date(Date.now() + 86400_000).toISOString() } as unknown as NonNullable<
        Awaited<ReturnType<typeof authMock>>
      >)
}

const ctx = { params: Promise.resolve({ id: 'b1' }) }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DELETE /api/builds/[id] (#161)', () => {
  it('Gast → 401, keine DB-Zugriffe', async () => {
    authMock.mockResolvedValue(asSession(null))
    const res = await DELETE(new Request('http://localhost/api/builds/b1', { method: 'DELETE' }), ctx)
    expect(res.status).toBe(401)
    expect(buildFindUnique).not.toHaveBeenCalled()
  })

  it('fremder Build → 404, kein delete-Aufruf', async () => {
    authMock.mockResolvedValue(asSession('other-1'))
    buildFindUnique.mockResolvedValue({ creatorId: 'creator-1' })
    const res = await DELETE(new Request('http://localhost/api/builds/b1', { method: 'DELETE' }), ctx)
    expect(res.status).toBe(404)
    expect(buildDelete).not.toHaveBeenCalled()
  })

  it('unbekannter Build → 404 (kein Leak, derselbe Code wie "fremd")', async () => {
    authMock.mockResolvedValue(asSession('user-1'))
    buildFindUnique.mockResolvedValue(null)
    const res = await DELETE(new Request('http://localhost/api/builds/b1', { method: 'DELETE' }), ctx)
    expect(res.status).toBe(404)
    expect(buildDelete).not.toHaveBeenCalled()
  })

  it('Ersteller:in löscht erfolgreich → 200', async () => {
    authMock.mockResolvedValue(asSession('creator-1'))
    buildFindUnique.mockResolvedValue({ creatorId: 'creator-1' })
    buildDelete.mockResolvedValue({ id: 'b1' })
    const res = await DELETE(new Request('http://localhost/api/builds/b1', { method: 'DELETE' }), ctx)
    expect(res.status).toBe(200)
    expect(buildDelete).toHaveBeenCalledWith({ where: { id: 'b1' } })
  })

  it('Build steckt noch in einem Deck (P2003) → 409 build_in_use statt 500', async () => {
    authMock.mockResolvedValue(asSession('creator-1'))
    buildFindUnique.mockResolvedValue({ creatorId: 'creator-1' })
    buildDelete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Foreign key constraint violated', { code: 'P2003', clientVersion: 'test' }),
    )
    const res = await DELETE(new Request('http://localhost/api/builds/b1', { method: 'DELETE' }), ctx)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'build_in_use' })
  })

  it('anderer DB-Fehler wird NICHT verschluckt (propagiert weiter)', async () => {
    authMock.mockResolvedValue(asSession('creator-1'))
    buildFindUnique.mockResolvedValue({ creatorId: 'creator-1' })
    buildDelete.mockRejectedValue(new Error('boom'))
    await expect(DELETE(new Request('http://localhost/api/builds/b1', { method: 'DELETE' }), ctx)).rejects.toThrow('boom')
  })
})
