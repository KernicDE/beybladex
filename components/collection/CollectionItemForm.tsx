// components/collection/CollectionItemForm.tsx
// Create/edit a CollectionItem (Phase 5 Part B). The item references exactly ONE catalog Part
// (partOrBeyId is a real FK to Part.id since Phase 5 Part A) — the picker searches the public
// parts catalog via GET /api/parts/search (same pattern as the deck builder's build picker),
// never a raw dropdown over the whole catalog. Schema fields only: partId, purchasePrice,
// currency, merchant, boughtAt (no condition/notes columns exist).
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'

interface PartResult {
  id: string
  name: string
  category: string
  manufacturer: string
  beyType: string | null
}

export interface ExistingCollectionItem {
  id: string
  part: { id: string; name: string }
  purchasePrice: number | null
  currency: string
  merchant: string | null
  boughtAt: Date | string | null
}

export function CollectionItemForm({ existing = null }: { existing?: ExistingCollectionItem | null }) {
  const router = useRouter()
  const [part, setPart] = useState<{ id: string; name: string } | null>(existing ? { id: existing.part.id, name: existing.part.name } : null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PartResult[]>([])
  const [searched, setSearched] = useState(false)
  const [price, setPrice] = useState(existing?.purchasePrice?.toString() ?? '')
  const [currency, setCurrency] = useState(existing?.currency ?? 'EUR')
  const [merchant, setMerchant] = useState(existing?.merchant ?? '')
  const [boughtAt, setBoughtAt] = useState(
    existing?.boughtAt ? new Date(existing.boughtAt).toISOString().slice(0, 10) : '',
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function search(e: React.FormEvent) {
    e.preventDefault()
    const res = await fetch(`/api/parts/search?q=${encodeURIComponent(query.trim())}`)
    if (!res.ok) return
    const body = (await res.json()) as { parts: PartResult[] }
    setResults(body.parts)
    setSearched(true)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!part) {
      setError('Bitte wähle ein Teil aus dem Katalog.')
      return
    }
    setBusy(true)
    setError(null)
    const payload = {
      partId: part.id,
      purchasePrice: price.trim() === '' ? null : Number(price),
      currency,
      merchant: merchant.trim() || null,
      boughtAt: boughtAt || null,
    }
    const res = await fetch(existing ? `/api/collection/${existing.id}` : '/api/collection', {
      method: existing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setBusy(false)
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      setError(body?.error ?? `Fehler (${res.status})`)
      return
    }
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <section aria-labelledby="collection-part" className="space-y-2">
        <h3 id="collection-part" className="font-medium">Teil</h3>
        {part ? (
          <div className="flex items-center gap-3 rounded-xl border border-x-cyan/20 p-3">
            <p className="min-w-0 flex-1 truncate font-medium">{part.name}</p>
            <Button variant="ghost" size="sm" onClick={() => setPart(null)}>Ändern</Button>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              <label htmlFor="collection-part-q" className="sr-only">Teil suchen</label>
              <Input
                id="collection-part-q"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Teilname, z. B. DranSword…"
              />
              <Button variant="secondary" onClick={search}>Suchen</Button>
            </div>
            {searched && results.length === 0 && <p className="text-sm text-current/60">Keine Teile gefunden.</p>}
            {results.length > 0 && (
              <ul className="divide-y rounded-xl border">
                {results.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{p.name}</p>
                      <p className="truncate text-sm text-current/60">{p.category} · {p.manufacturer}</p>
                    </div>
                    <Button size="sm" onClick={() => setPart({ id: p.id, name: p.name })}>Wählen</Button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Kaufpreis (optional)">
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="12.99"
          />
        </FormField>
        <FormField label="Währung">
          <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            <option value="EUR">EUR (€)</option>
            <option value="CHF">CHF</option>
            <option value="USD">USD ($)</option>
          </Select>
        </FormField>
        <FormField label="Händler (optional)">
          <Input value={merchant} onChange={(e) => setMerchant(e.target.value)} maxLength={120} placeholder="z. B. Spielzeugladen XY" />
        </FormField>
        <FormField label="Kaufdatum (optional)">
          <Input type="date" value={boughtAt} onChange={(e) => setBoughtAt(e.target.value)} />
        </FormField>
      </div>

      {error && <p role="alert" className="text-sm text-type-attack">{error}</p>}
      <Button type="submit" disabled={busy || !part}>
        {existing ? 'Eintrag speichern' : 'Zur Sammlung hinzufügen'}
      </Button>
    </form>
  )
}
