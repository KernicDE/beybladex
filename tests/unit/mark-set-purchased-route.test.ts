// tests/unit/mark-set-purchased-route.test.ts (#137/#153-Nachtrag)
// Schneller Seam-Test für POST /api/collection/mark-set-purchased — insbesondere boughtAt
// (Kaufdatum), das die bisherigen Integrationstests nie mitschickten (Live-Report: "Beyblade
// MIT Kaufdatum markiert, Mein Inventar bleibt leer"). Prüft die Request→Prisma-Datenformung
// ohne echte DB (CI-Postgres-Tests decken den vollen Round-Trip zusätzlich ab).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { authMock, beybladeFindUnique, transactionMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  beybladeFindUnique: vi.fn(),
  transactionMock: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ auth: authMock }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn().mockResolvedValue({ allowed: true }) }))
vi.mock('@/lib/db', () => ({
  prisma: {
    beyblade: { findUnique: beybladeFindUnique },
    purchase: { create: vi.fn((args: unknown) => ({ __op: 'purchase.create', args })) },
    collectionItem: { create: vi.fn((args: unknown) => ({ __op: 'collectionItem.create', args })) },
    $transaction: transactionMock,
  },
}))

import { POST } from '@/app/api/collection/mark-set-purchased/route'

function asSession(id: string) {
  return { user: { id, name: id }, expires: new Date(Date.now() + 86400_000).toISOString() } as unknown as NonNullable<
    Awaited<ReturnType<typeof authMock>>
  >
}

function req(body: unknown) {
  return new Request('http://localhost/api/collection/mark-set-purchased', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue(asSession('user-1'))
  beybladeFindUnique.mockResolvedValue({
    id: 'bey-1',
    bladeId: 'p-blade',
    lockChipId: null,
    overBladeId: null,
    metalBladeId: null,
    assistBladeId: null,
    ratchetId: 'p-ratchet',
    bitId: 'p-bit',
  })
  // $transaction receives the array of prisma "op" calls above — resolve with matching fakes.
  transactionMock.mockImplementation(async (ops: { __op: string }[]) =>
    ops.map((op, i) => (op.__op === 'purchase.create' ? { id: 'purchase-1' } : { id: `item-${i}` })),
  )
})

describe('POST /api/collection/mark-set-purchased — boughtAt (Kaufdatum)', () => {
  it('parst ein gültiges Kaufdatum (YYYY-MM-DD aus <input type=date>) fehlerfrei durch', async () => {
    const res = await POST(req({ beybladeId: 'bey-1', purchasePrice: 19.99, currency: 'EUR', merchant: 'Testladen', boughtAt: '2026-09-14' }))
    expect(res.status).toBe(201)
    const body = (await res.json()) as { purchaseId: string; ids: string[] }
    expect(body.purchaseId).toBe('purchase-1')
    // Ratchet-Integrated? nein — hier 3 belegte Slots (blade, ratchet, bit).
    expect(body.ids).toHaveLength(3)

    const calledOps = transactionMock.mock.calls[0][0] as { __op: string; args: { data: Record<string, unknown> } }[]
    for (const op of calledOps) {
      expect(op.args.data.boughtAt).toBeInstanceOf(Date)
      expect((op.args.data.boughtAt as Date).toISOString().slice(0, 10)).toBe('2026-09-14')
    }
  })

  it('funktioniert weiterhin ganz ohne Kaufdatum (boughtAt optional)', async () => {
    const res = await POST(req({ beybladeId: 'bey-1' }))
    expect(res.status).toBe(201)
    const calledOps = transactionMock.mock.calls[0][0] as { args: { data: Record<string, unknown> } }[]
    for (const op of calledOps) expect(op.args.data.boughtAt).toBeNull()
  })

  it('ein ungültiges Kaufdatum ist 400 invalid_boughtAt, nicht ein stiller Erfolg ohne Teile', async () => {
    const res = await POST(req({ beybladeId: 'bey-1', boughtAt: 'nicht-ein-datum' }))
    expect(res.status).toBe(400)
    expect((await res.json()) as { error: string }).toMatchObject({ error: 'invalid_boughtAt' })
    expect(transactionMock).not.toHaveBeenCalled()
  })
})
