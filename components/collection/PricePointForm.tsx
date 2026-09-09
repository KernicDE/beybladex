// components/collection/PricePointForm.tsx
// Log an additional price observation (Preisverlauf) for an owned CollectionItem —
// POST /api/collection/[id]/price-points, owner-only.
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'

export function PricePointForm({ itemId }: { itemId: string }) {
  const router = useRouter()
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState('EUR')
  const [recordedAt, setRecordedAt] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/collection/${itemId}/price-points`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        price: Number(price),
        currency,
        ...(recordedAt ? { recordedAt: new Date(recordedAt).toISOString() } : {}),
      }),
    })
    setBusy(false)
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      setError(body?.error ?? `Fehler (${res.status})`)
      return
    }
    setPrice('')
    setRecordedAt('')
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Preis">
          <Input type="number" inputMode="decimal" min={0} step="0.01" required value={price} onChange={(e) => setPrice(e.target.value)} placeholder="15.99" />
        </FormField>
        <FormField label="Währung">
          <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="EUR">EUR (€)</option>
            <option value="CHF">CHF</option>
            <option value="USD">USD ($)</option>
          </Select>
        </FormField>
        <FormField label="Datum (optional, Standard: heute)">
          <Input type="date" value={recordedAt} onChange={(e) => setRecordedAt(e.target.value)} />
        </FormField>
      </div>
      {error && <p role="alert" className="text-sm text-type-attack">{error}</p>}
      <Button type="submit" disabled={busy || price.trim() === ''}>Preis eintragen</Button>
    </form>
  )
}
