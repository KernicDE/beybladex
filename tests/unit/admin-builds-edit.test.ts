// tests/unit/admin-builds-edit.test.ts (RC16 #108)
// Kuratoren-Edit einzelner Builds: PATCH /api/admin/builds/[id] (Name/Typ, AuditLog) und
// POST /api/admin/builds/[id]/image (Media-Pipeline). Seam-Mocks auf '@/lib/guards',
// '@/lib/db', '@/lib/rateLimit', '@/lib/media' — kein echtes DB/Dateisystem; die
// DB-gestuetzte Authz-Matrix bleibt der Integration-Suite ueberlassen.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const gate = vi.fn()
const buildFindUnique = vi.fn()
const buildUpdate = vi.fn()
const auditCreate = vi.fn()
const txBuildUpdate = vi.fn()
const txAuditCreate = vi.fn()
const rateLimit = vi.fn()
const processAndStoreImage = vi.fn()

vi.mock('@/lib/guards', () => ({ requireCurator: (...a: unknown[]) => gate(...a) }))
vi.mock('@/lib/db', () => ({
  prisma: {
    build: {
      findUnique: (...a: unknown[]) => buildFindUnique(...a),
      update: (...a: unknown[]) => buildUpdate(...a),
    },
    auditLog: { create: (...a: unknown[]) => auditCreate(...a) },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({ build: { update: txBuildUpdate }, auditLog: { create: txAuditCreate } }),
    ),
  },
}))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: (...a: unknown[]) => rateLimit(...a) }))
vi.mock('@/lib/media', () => ({
  BUILD_IMAGE_TARGET: { width: 512, height: 512, fit: 'cover' },
  processAndStoreImage: (...a: unknown[]) => processAndStoreImage(...a),
}))

import { PATCH } from '@/app/api/admin/builds/[id]/route'
import { POST as POST_IMAGE } from '@/app/api/admin/builds/[id]/image/route'

function asCurator(userId = 'curator-1') {
  gate.mockResolvedValue({ userId })
}
function asForbidden() {
  gate.mockResolvedValue({ error: Response.json({ error: 'forbidden' }, { status: 403 }) })
}
function patchReq(body: unknown) {
  return new Request('http://localhost/api/admin/builds/b1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
const ctx = { params: Promise.resolve({ id: 'b1' }) }

beforeEach(() => {
  vi.clearAllMocks()
  rateLimit.mockResolvedValue({ allowed: true })
})

describe('PATCH /api/admin/builds/[id] (issue #108)', () => {
  it('curator aendert Name und Typ — Update plus AuditLog-Eintrag', async () => {
    asCurator()
    buildFindUnique.mockResolvedValue({ id: 'b1', name: 'Sword Dran 3-60F' })
    txBuildUpdate.mockResolvedValue({ id: 'b1', name: 'Sword Dran 3-60F', type: 'ATTACK' })

    const res = await PATCH(patchReq({ name: 'Sword Dran 3-60F', type: 'STAMINA' }), ctx)

    expect(res.status).toBe(200)
    expect(txBuildUpdate).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { name: 'Sword Dran 3-60F', type: 'STAMINA' } })
    expect(txAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'build.update', targetType: 'build' }) }),
    )
  })

  it('leerer Name wird als null gespeichert (kanonische Ableitung gilt wieder)', async () => {
    asCurator()
    buildFindUnique.mockResolvedValue({ id: 'b1', name: 'Alt' })
    txBuildUpdate.mockResolvedValue({ id: 'b1', name: null, type: 'ATTACK' })

    const res = await PATCH(patchReq({ name: null }), ctx)

    expect(res.status).toBe(200)
    expect(txBuildUpdate).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { name: null } })
  })

  it('unbekannter Build → 404, leerer Patch → 400, ungueltiger Typ → 400', async () => {
    asCurator()
    buildFindUnique.mockResolvedValue(null)
    expect((await PATCH(patchReq({ name: 'X' }), ctx)).status).toBe(404)

    buildFindUnique.mockResolvedValue({ id: 'b1', name: 'X' })
    expect((await PATCH(patchReq({}), ctx)).status).toBe(400)
    expect((await PATCH(patchReq({ type: 'SPINNY' }), ctx)).status).toBe(400)
  })

  it('nicht-Kurator wird am Gate mit 403 abgewiesen (kein DB-Zugriff)', async () => {
    asForbidden()
    const res = await PATCH(patchReq({ name: 'X' }), ctx)
    expect(res.status).toBe(403)
    expect(buildFindUnique).not.toHaveBeenCalled()
  })
})

describe('POST /api/admin/builds/[id]/image (issue #108)', () => {
  function imageReq() {
    const form = new FormData()
    form.set('image', new File(['x'], 'box.png', { type: 'image/png' }))
    const req = new Request('http://localhost/api/admin/builds/b1/image', { method: 'POST' })
    // Multipart-Bau sparen: formData direkt stubben (der Route-Code konsumiert nur diese Methode).
    req.formData = async () => form
    return req
  }

  it('speichert das Asset und schreibt Build.imageId um', async () => {
    asCurator()
    buildFindUnique.mockResolvedValue({ id: 'b1' })
    processAndStoreImage.mockResolvedValue({ id: 'asset-1', width: 512, height: 512, sizeBytes: 10 })

    const res = await POST_IMAGE(imageReq(), ctx)

    expect(res.status).toBe(200)
    expect(processAndStoreImage).toHaveBeenCalledWith(expect.anything(), { width: 512, height: 512, fit: 'cover' }, 'curator-1')
    expect(buildUpdate).toHaveBeenCalledWith({ where: { id: 'b1' }, data: { imageId: 'asset-1' } })
  })

  it('unbekannter Build → 404 vor dem Upload', async () => {
    asCurator()
    buildFindUnique.mockResolvedValue(null)

    expect((await POST_IMAGE(imageReq(), ctx)).status).toBe(404)
    expect(processAndStoreImage).not.toHaveBeenCalled()
  })
})
