// tests/unit/mark-set-purchased-route.test.ts (#137/#153-Nachtrag)
// Schneller Seam-Test für POST /api/collection/mark-set-purchased — insbesondere boughtAt
// (Kaufdatum), das die bisherigen Integrationstests nie mitschickten (Live-Report: "Beyblade
// MIT Kaufdatum markiert, Mein Inventar bleibt leer"). Prüft die Request→Prisma-Datenformung
// ohne echte DB (CI-Postgres-Tests decken den vollen Round-Trip zusätzlich ab).
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Issue #169 — createBeybladePurchase nutzt die INTERACTIVE-Form von $transaction (ein
// Callback, kein Array-von-ops mehr), weil CollectionItem.purchaseId die echte purchase.id aus
// dem vorherigen purchase.create braucht. purchaseCreateMock/collectionItemCreateMock sind
// separat greifbar, damit die tx-Fake-Implementierung unten sie direkt aufrufen kann.
const { authMock, beybladeFindUnique, transactionMock, purchaseCreateMock, collectionItemCreateMock } = vi.hoisted(() => ({
  authMock: vi.fn(),
  beybladeFindUnique: vi.fn(),
  transactionMock: vi.fn(),
  purchaseCreateMock: vi.fn((args: unknown) => ({ __op: 'purchase.create', args })),
  collectionItemCreateMock: vi.fn((args: unknown) => ({ __op: 'collectionItem.create', args })),
}))

vi.mock('@/lib/auth', () => ({ auth: authMock }))
vi.mock('@/lib/rateLimit', () => ({ rateLimit: vi.fn().mockResolvedValue({ allowed: true }) }))
vi.mock('@/lib/db', () => ({
  prisma: {
    beyblade: { findUnique: beybladeFindUnique },
    purchase: { create: purchaseCreateMock },
    collectionItem: { create: collectionItemCreateMock },
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
  // Issue #169 — $transaction bekommt jetzt einen Callback (tx) => {...} statt eines Arrays;
  // der Fake ruft ihn mit einem tx-Objekt auf, dessen create-Mocks feste ids zurückgeben.
  let itemCounter = 0
  transactionMock.mockImplementation(async (fn: (tx: unknown) => unknown) =>
    fn({
      purchase: { create: (a: unknown) => { purchaseCreateMock(a); return { id: 'purchase-1' } } },
      collectionItem: { create: (a: unknown) => { collectionItemCreateMock(a); return { id: `item-${itemCounter++}` } } },
    }),
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

    // Issue #169 — purchaseCreateMock/collectionItemCreateMock sind jetzt die direkt greifbaren
    // Spies (statt eines Arrays von $transaction-"ops"), da $transaction seinen Callback selbst
    // aufruft statt ein Array entgegenzunehmen.
    const calledArgs = [...purchaseCreateMock.mock.calls, ...collectionItemCreateMock.mock.calls].map((c) => c[0] as { data: Record<string, unknown> })
    for (const args of calledArgs) {
      expect(args.data.boughtAt).toBeInstanceOf(Date)
      expect((args.data.boughtAt as Date).toISOString().slice(0, 10)).toBe('2026-09-14')
    }
  })

  it('funktioniert weiterhin ganz ohne Kaufdatum (boughtAt optional)', async () => {
    const res = await POST(req({ beybladeId: 'bey-1' }))
    expect(res.status).toBe(201)
    const calledArgs = [...purchaseCreateMock.mock.calls, ...collectionItemCreateMock.mock.calls].map((c) => c[0] as { data: Record<string, unknown> })
    for (const args of calledArgs) expect(args.data.boughtAt).toBeNull()
  })

  it('ein ungültiges Kaufdatum ist 400 invalid_boughtAt, nicht ein stiller Erfolg ohne Teile', async () => {
    const res = await POST(req({ beybladeId: 'bey-1', boughtAt: 'nicht-ein-datum' }))
    expect(res.status).toBe(400)
    expect((await res.json()) as { error: string }).toMatchObject({ error: 'invalid_boughtAt' })
    expect(transactionMock).not.toHaveBeenCalled()
  })
})
