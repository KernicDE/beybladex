// components/collection/MarkSetPurchasedForm.tsx (Phase 11, item 6; RC16 #103; MVP4 #141)
// "Set als gekauft markieren" — eine Beyblade-Suche (GET /api/beyblades) plus die gleichen
// Kauf-Felder wie CollectionItemForm, POSTing zu /api/collection/mark-set-purchased mit
// beybladeId. Schreibt EINE Purchase-Row (Besitz-Einheit, Basis des Preisverlaufs) plus je
// belegtem Slot eine CollectionItem-Row als Provenienz — siehe die Route für warum.
// RC16 (#103): mit `beyblade` als Prop entfaellt die Suche — die Detailseite kennt die id
// bereits und rendert nur noch die Kauf-Felder.
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { errorMessage } from '@/lib/errorCopy'

interface BeybladeOption {
  id: string
  name: string
}

export function MarkSetPurchasedForm({ beyblade = null }: { beyblade?: { id: string; name: string } | null }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<BeybladeOption[]>([])
  // RC16 (#103): steht die Beyblade bereits fest (Detailseite), entfaellt die Suche —
  // beybladeId ist bekannt, die Komponente startet direkt mit dem ausgewaehlten Set.
  const [selected, setSelected] = useState<BeybladeOption | null>(beyblade)
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState('EUR')
  const [merchant, setMerchant] = useState('')
  const [boughtAt, setBoughtAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function search(e: React.FormEvent) {
    e.preventDefault()
    const res = await fetch(`/api/beyblades?q=${encodeURIComponent(query.trim())}`)
    if (!res.ok) return
    const body = (await res.json()) as { beyblades: BeybladeOption[] }
    setResults(body.beyblades)
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
        beybladeId: selected.id,
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
        Set als gekauft markiert — es ist jetzt in deinem Besitz und alle Teile in deiner Sammlung.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      {!selected ? (
        <form onSubmit={search} className="flex items-center gap-2">
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Set-Name oder Code, z. B. Reaper Rhino…" />
          <Button variant="secondary" onClick={search}>Suchen</Button>
        </form>
      ) : (
        <p className="text-sm">
          Set: <strong>{selected.name}</strong>{' '}
          {!beyblade && (
            <button type="button" onClick={() => setSelected(null)} className="text-x-cyan-text underline">
              ändern
            </button>
          )}
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
