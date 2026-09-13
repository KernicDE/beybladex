// components/beyblade/PurchaseForm.tsx (MVP4, #139/#142)
// "Als gekauft markieren" auf der Beyblade-Detailseite — POST /api/beyblades/[id]/purchases.
// Alle Angaben optional (#139: erst markieren, dann OPTIONAL nach Händler/Datum/Preis fragen).
// Händler-Autocomplete via <datalist>: ab 3 Zeichen werden Vorschläge von
// /api/merchants/suggest nachgeladen (debounced — sonst schlägt das 60/min-Limit beim Tippen
// zu, bevor ein Vorschlag überhaupt ankommt).
'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { errorMessage } from '@/lib/errorCopy'

const SUGGEST_DEBOUNCE_MS = 250

export function PurchaseForm({ beybladeId }: { beybladeId: string }) {
  const router = useRouter()
  const listId = useId()
  const [merchant, setMerchant] = useState('')
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [price, setPrice] = useState('')
  const [currency, setCurrency] = useState('EUR')
  const [boughtAt, setBoughtAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // Debounce + Ignore-stale: nur der letzte Fetch darf die Liste überschreiben. Unter 3
  // Zeichen wird nichts gerendert (visibleSuggestions unten) — ein Sync-setState im Effect
  // wäre verboten (react-hooks/set-state-in-effect), die abgelaufene Liste harmoniert als
  // datalist-Vorschlag ohnehin nur mit dem aktuellen Prefix.
  const requestSeq = useRef(0)
  useEffect(() => {
    const q = merchant.trim()
    if (q.length < 3) return
    const seq = ++requestSeq.current
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/merchants/suggest?q=${encodeURIComponent(q)}`)
      if (seq !== requestSeq.current) return
      if (!res.ok) {
        if (res.status !== 429) setSuggestions([])
        return
      }
      const body = (await res.json()) as { merchants?: string[] }
      if (seq === requestSeq.current) setSuggestions(body.merchants ?? [])
    }, SUGGEST_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [merchant])

  const visibleSuggestions = merchant.trim().length >= 3 ? suggestions : []

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/beyblades/${beybladeId}/purchases`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merchant: merchant === '' ? undefined : merchant,
        price: price === '' ? undefined : Number(price),
        currency,
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
      <div className="space-y-2">
        <p role="status" className="text-sm text-type-balance">Als gekauft markiert — der Eintrag erscheint unten in deiner Liste.</p>
        <Button variant="ghost" size="sm" onClick={() => { setDone(false); setMerchant(''); setPrice(''); setBoughtAt('') }}>
          Weiteren Kauf eintragen
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Händler (optional)" htmlFor={`${listId}-input`}>
          <Input
            id={`${listId}-input`}
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            list={listId}
            placeholder="z. B. Amazon.de"
            autoComplete="off"
          />
        </FormField>
        <datalist id={listId}>
          {visibleSuggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <FormField label="Kaufdatum (optional)">
          <Input type="date" value={boughtAt} onChange={(e) => setBoughtAt(e.target.value)} />
        </FormField>
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
      </div>
      {error && <p role="alert" className="text-sm text-type-attack">{error}</p>}
      <Button type="submit" disabled={busy}>
        {busy ? 'Speichere…' : 'Als gekauft markieren'}
      </Button>
    </form>
  )
}
