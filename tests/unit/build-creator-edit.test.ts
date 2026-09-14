// tests/unit/build-creator-edit.test.ts (MVP4/5, #145)
// PATCH /api/builds/[id] — die einzige Build-Schreibstelle neben dem Create: Sichtbarkeit
// (#144) plus seit #145 Name/Typ, ausschließlich für die Erstellerin bzw. den Ersteller
// (creatorId). Kuratoren/Admins bekommen für fremde Builds denselben 404 wie jede andere
// Person — der Vor-Split-Kuratoren-Pfad /api/admin/builds/[id] ist entfernt. Seam-Mocks
// auf '@/lib/auth' und '@/lib/db' — die DB-gestützte Authz-Matrix prüft
// tests/integration/permission-matrix.test.ts.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock factories are hoisted ABOVE top-level declarations — the spies must come from
// vi.hoisted() or the factory hits the const's TDZ ("Cannot access before initialization"),
// which surfaces whenever the mock graph initializes eagerly (CI runs test:all = unit+integration).
const { authMock, buildFindUnique, buildUpdate } = vi.hoisted(() => ({
  authMock: vi.fn(),
  buildFindUnique: vi.fn(),
  buildUpdate: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: authMock }))
vi.mock('@/lib/db', () => ({
  prisma: {
    build: {
      findUnique: buildFindUnique,
      update: buildUpdate,
    },
  },
}))

import { PATCH } from '@/app/api/builds/[id]/route'

const CREATOR = 'creator-1'
const OTHER = 'other-1'

function asSession(id: string | null) {
  return id === null
    ? null
    : ({ user: { id, name: id }, expires: new Date(Date.now() + 86400_000).toISOString() } as unknown as NonNullable<
        Awaited<ReturnType<typeof authMock>>
      >)
}

function patchReq(body: unknown): Request {
  return new Request('http://localhost/api/builds/b1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const ctx = { params: Promise.resolve({ id: 'b1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue(asSession(CREATOR))
  buildFindUnique.mockResolvedValue({ creatorId: CREATOR })
  buildUpdate.mockResolvedValue({ id: 'b1' })
})

describe('PATCH /api/builds/[id] — Creator-Edit (#145)', () => {
  it('Ersteller:in setzt Name, Typ und Sichtbarkeit in einem Patch', async () => {
    const res = await PATCH(patchReq({ name: 'Mein Dranzer', type: 'ATTACK', visibility: 'PUBLIC' }), ctx)
    expect(res.status).toBe(200)
    expect(buildUpdate).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { name: 'Mein Dranzer', type: 'ATTACK', visibility: 'PUBLIC' },
    })
  })

  it('leerer Name → null (kanonische Ableitung gilt wieder); type bleibt NOT NULL', async () => {
    const res = await PATCH(patchReq({ name: '   ' }), ctx)
    expect(res.status).toBe(200)
    expect(buildUpdate).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { name: null } })

    // type ist @default(ATTACK) NOT NULL in der DB — anders als name gibt es keinen
    // "leer → abgeleitet"-Zustand; null wird wie jeder andere ungültige Enum-Wert 400.
    expect((await PATCH(patchReq({ type: null }), ctx)).status).toBe(400)
  })

  it('Name wird getrimmt und auf 160 Zeichen begrenzt-validiert', async () => {
    const res = await PATCH(patchReq({ name: '  Dranzer  ' }), ctx)
    expect(res.status).toBe(200)
    expect(buildUpdate).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { name: 'Dranzer' } })

    expect((await PATCH(patchReq({ name: 'x'.repeat(161) }), ctx)).status).toBe(400)
    expect((await PATCH(patchReq({ name: 42 }), ctx)).status).toBe(400)
  })

  it('ungültiger Typ / ungültige Sichtbarkeit / leerer Patch → 400', async () => {
    expect((await PATCH(patchReq({ type: 'SPINNY' }), ctx)).status).toBe(400)
    expect((await PATCH(patchReq({ visibility: 'SECRET' }), ctx)).status).toBe(400)
    expect((await PATCH(patchReq({}), ctx)).status).toBe(400)
    expect(buildUpdate).not.toHaveBeenCalled()
  })

  it('fremder Build (auch als Kurator/Admin) → 404 ohne Update; Existenz wird nicht geleakt', async () => {
    authMock.mockResolvedValue(asSession(OTHER))
    const res = await PATCH(patchReq({ name: 'X' }), ctx)
    expect(res.status).toBe(404)
    expect(buildUpdate).not.toHaveBeenCalled()
  })

  it('Vor-MVP4-Build ohne Creator → niemand darf, 404', async () => {
    buildFindUnique.mockResolvedValue({ creatorId: null })
    const res = await PATCH(patchReq({ visibility: 'PUBLIC' }), ctx)
    expect(res.status).toBe(404)
    expect(buildUpdate).not.toHaveBeenCalled()
  })

  it('anonym → 401 vor jedem DB-Zugriff', async () => {
    authMock.mockResolvedValue(asSession(null))
    const res = await PATCH(patchReq({ name: 'X' }), ctx)
    expect(res.status).toBe(401)
    expect(buildFindUnique).not.toHaveBeenCalled()
    expect(buildUpdate).not.toHaveBeenCalled()
  })
})
