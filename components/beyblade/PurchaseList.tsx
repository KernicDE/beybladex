// components/beyblade/PurchaseList.tsx (MVP4, #139/#142)
// Eigene Käufe einer Beyblade auf der Detailseite: Zeilen-Liste mit Edit (PATCH
// /api/purchases/[id] — Händler/Datum/Preis/Währung, inline im Listenplatz wie RatingList)
// und Delete (bestätigt, wie CollectionDeleteButton). `purchases` wird server-seitig geladen
// und reingegeben — der Client kennt die Viewer-Id nie.
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { errorMessage } from '@/lib/errorCopy'

export interface PurchaseListItem {
  id: string
  merchant: string | null
  boughtAt: string | null
  price: number | null
  currency: string
  createdAt: string
}

function formatRow(p: PurchaseListItem): string {
  const parts: string[] = []
  if (p.merchant) parts.push(p.merchant)
  const date = new Date(p.boughtAt ?? p.createdAt).toLocaleDateString('de-DE')
  parts.push(`am ${date}`)
  if (p.price !== null) parts.push(`für ${p.price.toFixed(2)} ${p.currency}`)
  return parts.join(' ')
}

export function PurchaseList({ purchases }: { purchases: PurchaseListItem[] }) {
  const router = useRouter()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Edit-Felder (pro Liste ein Satz — gleichzeitig editiert nur eine Zeile).
  const [merchant, setMerchant] = useState('')
  const [boughtAt, setBoughtAt] = useState('')
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState('EUR')

  function startEdit(p: PurchaseListItem) {
    setEditingId(p.id)
    setConfirmingId(null)
    setError(null)
    setMerchant(p.merchant ?? '')
    setBoughtAt(p.boughtAt ? p.boughtAt.slice(0, 10) : '')
    setPrice(p.price !== null ? String(p.price) : '')
    setCurrency(p.currency)
  }

  async function save(purchaseId: string) {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/purchases/${purchaseId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchant: merchant === '' ? null : merchant,
        boughtAt: boughtAt === '' ? null : boughtAt,
        price: price === '' ? null : Number(price),
        currency,
      }),
    })
    setBusy(false)
    if (res.ok) {
      setEditingId(null)
      router.refresh()
    } else {
      setError(errorMessage((await res.json().catch(() => null))?.error ?? 'unknown'))
    }
  }

  async function remove(purchaseId: string) {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/purchases/${purchaseId}`, { method: 'DELETE' })
    setBusy(false)
    setConfirmingId(null)
    if (!res.ok) {
      setError(errorMessage((await res.json().catch(() => null))?.error ?? 'unknown'))
      return
    }
    router.refresh()
  }

  return (
    <div className="space-y-3">
      <ul className="divide-y rounded-md border">
        {purchases.map((p) => (
          <li key={p.id} className="px-3 py-2">
            {editingId === p.id ? (
              <div className="space-y-3 py-1">
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label="Händler">
                    <Input value={merchant} onChange={(e) => setMerchant(e.target.value)} autoComplete="off" />
                  </FormField>
                  <FormField label="Kaufdatum">
                    <Input type="date" value={boughtAt} onChange={(e) => setBoughtAt(e.target.value)} />
                  </FormField>
                  <FormField label="Kaufpreis">
                    <Input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
                  </FormField>
                  <FormField label="Währung">
                    <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                      <option value="EUR">EUR</option>
                      <option value="CHF">CHF</option>
                      <option value="USD">USD</option>
                    </Select>
                  </FormField>
                </div>
                {error && <p role="alert" className="text-sm text-type-attack">{error}</p>}
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => save(p.id)} disabled={busy}>Speichern</Button>
                  <Button variant="ghost" size="sm" onClick={() => setEditingId(null)} disabled={busy}>Abbrechen</Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">Gekauft {formatRow(p)}</span>
                <div className="flex gap-2">
                  <Button variant="ghost" size="sm" onClick={() => startEdit(p)}>Bearbeiten</Button>
                  {confirmingId === p.id ? (
                    <>
                      <Button variant="danger" size="sm" onClick={() => remove(p.id)} disabled={busy}>Ja, löschen</Button>
                      <Button variant="ghost" size="sm" onClick={() => setConfirmingId(null)} disabled={busy}>Abbrechen</Button>
                    </>
                  ) : (
                    <Button variant="danger" size="sm" onClick={() => { setConfirmingId(p.id); setEditingId(null) }}>
                      Löschen
                    </Button>
                  )}
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {error && editingId === null && <p role="alert" className="text-sm text-type-attack">{error}</p>}
    </div>
  )
}
