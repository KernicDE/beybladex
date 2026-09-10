// components/collection/MarkSetPurchasedForm.tsx (Phase 11, item 6)
// "Set als gekauft markieren" — an official-Set search picker (isOfficialSet: true only) plus
// the same shared purchase fields as CollectionItemForm, POSTing to
// /api/collection/mark-set-purchased. Creates THREE linked CollectionItem rows in one call —
// see that route's header comment for why (provenance, not a new ownership unit).
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { errorMessage } from '@/lib/errorCopy'

interface SetOption {
  id: string
  name: string | null
}

export function MarkSetPurchasedForm() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SetOption[]>([])
  const [selected, setSelected] = useState<SetOption | null>(null)
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState('EUR')
  const [merchant, setMerchant] = useState('')
  const [boughtAt, setBoughtAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function search(e: React.FormEvent) {
    e.preventDefault()
    const res = await fetch(`/api/builds?q=${encodeURIComponent(query.trim())}`)
    if (!res.ok) return
    const body = (await res.json()) as { builds: { id: string; name: string | null; isOfficialSet: boolean }[] }
    setResults(body.builds.filter((b) => b.isOfficialSet).map((b) => ({ id: b.id, name: b.name })))
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!selected) return
    setBusy(true)
    setError(null)
    const res = await fetch('/api/collection/mark-set-purchased', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        buildId: selected.id,
        purchasePrice: price === '' ? undefined : Number(price),
        currency,
        merchant: merchant === '' ? undefined : merchant,
        boughtAt: boughtAt === '' ? undefined : boughtAt,
      }),
    })
    setBusy(false)
    if (res.ok) {
      setDone(true)
      router.refresh()
    } else {
      setError(errorMessage((await res.json().catch(() => null))?.error ?? 'unknown'))
    }
  }

  if (done) {
    return (
      <p role="status" className="text-sm text-type-balance">
        Set als gekauft markiert — alle drei Teile sind jetzt in deiner Sammlung.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {!selected ? (
        <form onSubmit={search} className="flex items-center gap-2">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Set-Name, z. B. Reaper Rhino…" />
          <Button variant="secondary" onClick={search}>Suchen</Button>
        </form>
      ) : (
        <p className="text-sm">
          Set: <strong>{selected.name}</strong>{' '}
          <button type="button" onClick={() => setSelected(null)} className="text-x-cyan-text underline">
            ändern
          </button>
        </p>
      )}
      {!selected && results.length > 0 && (
        <ul className="divide-y rounded-md border">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setSelected(r)}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-current/5"
              >
                {r.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {selected && (
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Kaufpreis (optional)">
              <Input type="number" min="0" step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} />
            </FormField>
            <FormField label="Währung">
              <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                <option value="EUR">EUR</option>
                <option value="CHF">CHF</option>
                <option value="USD">USD</option>
              </Select>
            </FormField>
            <FormField label="Händler (optional)">
              <Input value={merchant} onChange={(e) => setMerchant(e.target.value)} />
            </FormField>
            <FormField label="Kaufdatum (optional)">
              <Input type="date" value={boughtAt} onChange={(e) => setBoughtAt(e.target.value)} />
            </FormField>
          </div>
          {error && <p role="alert" className="text-sm text-type-attack">{error}</p>}
          <Button type="submit" disabled={busy}>
            {busy ? 'Speichere…' : 'Als gekauft markieren'}
          </Button>
        </form>
      )}
    </div>
  )
}
