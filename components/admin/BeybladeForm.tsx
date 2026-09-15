// components/admin/BeybladeForm.tsx (Issue #188)
// Curator direct-create of an official Set — the UI counterpart POST /api/admin/builds was
// missing so far (only reachable via raw API). Same 3-slot picker UX as
// components/beyblade/BuildComboForm.tsx (RC16 #122's own documented scope boundary: the UI
// forms expose only the Standard-Bauform — Blade + Ratchet + Bit; the ~16 CX-/Ratchet-
// Integrated sets are rarer retail products and go through the CatalogProposal review path,
// same as that form). AUTHZ RULE: the server (requireCurator — TRUSTED/JUDGE/ORGANIZER/ADMIN)
// is the actual gate; this component is only reachable from the Sammlung page's "+" toggle,
// itself gated narrower to TRUSTED/ADMIN (#188's own two-tier split — see app/collection/page.tsx).
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { errorMessage } from '@/lib/errorCopy'

interface PartOption {
  id: string
  name: string
}

const SLOTS = [
  { key: 'bladeId', label: 'Blade', category: 'BLADE' },
  { key: 'ratchetId', label: 'Ratchet', category: 'RATCHET' },
  { key: 'bitId', label: 'Bit', category: 'BIT' },
] as const

function SlotPicker({
  slot,
  value,
  onChange,
}: {
  slot: (typeof SLOTS)[number]
  value: PartOption | null
  onChange: (p: PartOption | null) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<(PartOption & { category: string })[]>([])

  async function search(e: React.FormEvent) {
    e.preventDefault()
    const res = await fetch(`/api/parts/search?category=${slot.category}&q=${encodeURIComponent(query.trim())}`)
    if (!res.ok) return
    const body = (await res.json()) as { parts: (PartOption & { category: string })[] }
    setResults(body.parts)
  }

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-x-cyan/20 p-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{value.name}</p>
        <Button variant="ghost" size="sm" onClick={() => onChange(null)}>Ändern</Button>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <label htmlFor={`bf-${slot.key}`} className="sr-only">{slot.label} suchen</label>
        <Input
          id={`bf-${slot.key}`}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`${slot.label}-Name…`}
        />
        <Button variant="secondary" size="sm" onClick={search}>Suchen</Button>
      </div>
      {results.length > 0 && (
        <ul className="max-h-40 divide-y overflow-y-auto rounded-xl border">
          {results.map((p) => (
            <li key={p.id} className="flex items-center gap-2 px-3 py-2">
              <p className="min-w-0 flex-1 truncate text-sm">{p.name}</p>
              <Button size="sm" onClick={() => onChange({ id: p.id, name: p.name })}>Wählen</Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function BeybladeForm({ onCreated }: { onCreated: (beyblade: { id: string }) => void }) {
  const [name, setName] = useState('')
  const [manufacturer, setManufacturer] = useState('TT')
  const [productCode, setProductCode] = useState('')
  const [parts, setParts] = useState<Record<string, PartOption | null>>({ bladeId: null, ratchetId: null, bitId: null })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const complete = name.trim() !== '' && parts.bladeId && parts.ratchetId && parts.bitId

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!complete) {
      setError('Bitte Name sowie je ein Blade, Ratchet und Bit angeben.')
      return
    }
    setBusy(true)
    setError(null)
    const res = await fetch('/api/admin/builds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        manufacturer,
        productCode: productCode.trim() === '' ? null : productCode.trim(),
        bladeId: parts.bladeId!.id,
        ratchetId: parts.ratchetId!.id,
        bitId: parts.bitId!.id,
      }),
    })
    setBusy(false)
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      setError(errorMessage(body?.error ?? 'unknown'))
      return
    }
    const body = (await res.json()) as { id: string; existing: boolean }
    onCreated(body)
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Set-Name">
          <Input required value={name} onChange={(e) => setName(e.target.value)} maxLength={160} placeholder="z. B. Reaper Rhino C 4-55D" />
        </FormField>
        <FormField label="Hersteller">
          <Select value={manufacturer} onChange={(e) => setManufacturer(e.target.value)}>
            <option value="TT">Takara Tomy</option>
            <option value="HASBRO">Hasbro</option>
          </Select>
        </FormField>
        <FormField label="Produktcode (optional)">
          <Input value={productCode} onChange={(e) => setProductCode(e.target.value)} maxLength={32} placeholder="z. B. G0290" />
        </FormField>
      </div>
      {SLOTS.map((slot) => (
        <FormField key={slot.key} label={slot.label}>
          <SlotPicker slot={slot} value={parts[slot.key]} onChange={(p) => setParts((v) => ({ ...v, [slot.key]: p }))} />
        </FormField>
      ))}
      {error && <p role="alert" className="text-sm text-type-attack">{error}</p>}
      <Button type="submit" disabled={busy || !complete}>
        Set anlegen
      </Button>
    </form>
  )
}
