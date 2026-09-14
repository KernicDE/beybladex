// tests/unit/deck-delete.test.ts (#164)
// DELETE /api/decks/[id] — Owner-only (dieselbe Prüfung wie PATCH: 404 für alle anderen, kein
// Leak). P2003-Übersetzung bleibt defensiv erhalten, auch wenn DeckBuild/TournamentParticipant/
// TeamTournamentSlot ihn laut Schema nie auslösen sollten (siehe tests/integration/deck-delete.test.ts).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Prisma } from '@prisma/client'

const { authMock, deckFindUnique, deckDelete } = vi.hoisted(() => ({
  authMock: vi.fn(),
  deckFindUnique: vi.fn(),
  deckDelete: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: authMock }))
vi.mock('@/lib/db', () => ({
  prisma: { deck: { findUnique: deckFindUnique, delete: deckDelete } },
}))

import { DELETE } from '@/app/api/decks/[id]/route'

function asSession(id: string | null) {
  return id === null
    ? null
    : ({ user: { id, name: id }, expires: new Date(Date.now() + 86400_000).toISOString() } as unknown as NonNullable<
        Awaited<ReturnType<typeof authMock>>
      >)
}

const ctx = { params: Promise.resolve({ id: 'd1' }) }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DELETE /api/decks/[id] (#164)', () => {
  it('Gast → 401, keine DB-Zugriffe', async () => {
    authMock.mockResolvedValue(asSession(null))
    const res = await DELETE(new Request('http://localhost/api/decks/d1', { method: 'DELETE' }), ctx)
    expect(res.status).toBe(401)
    expect(deckFindUnique).not.toHaveBeenCalled()
  })

  it('fremdes Deck → 404, kein delete-Aufruf', async () => {
    authMock.mockResolvedValue(asSession('other-1'))
    deckFindUnique.mockResolvedValue({ userId: 'owner-1' })
    const res = await DELETE(new Request('http://localhost/api/decks/d1', { method: 'DELETE' }), ctx)
    expect(res.status).toBe(404)
    expect(deckDelete).not.toHaveBeenCalled()
  })

  it('unbekanntes Deck → 404 (kein Leak)', async () => {
    authMock.mockResolvedValue(asSession('user-1'))
    deckFindUnique.mockResolvedValue(null)
    const res = await DELETE(new Request('http://localhost/api/decks/d1', { method: 'DELETE' }), ctx)
    expect(res.status).toBe(404)
    expect(deckDelete).not.toHaveBeenCalled()
  })

  it('Besitzer:in löscht erfolgreich → 200', async () => {
    authMock.mockResolvedValue(asSession('owner-1'))
    deckFindUnique.mockResolvedValue({ userId: 'owner-1' })
    deckDelete.mockResolvedValue({ id: 'd1' })
    const res = await DELETE(new Request('http://localhost/api/decks/d1', { method: 'DELETE' }), ctx)
    expect(res.status).toBe(200)
    expect(deckDelete).toHaveBeenCalledWith({ where: { id: 'd1' } })
  })

  it('P2003 (defensiv) → 409 deck_in_use statt 500', async () => {
    authMock.mockResolvedValue(asSession('owner-1'))
    deckFindUnique.mockResolvedValue({ userId: 'owner-1' })
    deckDelete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Foreign key constraint violated', { code: 'P2003', clientVersion: 'test' }),
    )
    const res = await DELETE(new Request('http://localhost/api/decks/d1', { method: 'DELETE' }), ctx)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'deck_in_use' })
  })
})
