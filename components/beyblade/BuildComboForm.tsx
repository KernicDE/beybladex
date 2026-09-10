// components/beyblade/BuildComboForm.tsx
// Phase 11 (item 2): register a one-off personal combo from three existing catalog parts —
// POST /api/builds (any logged-in user; the server forces isOfficialSet=false). Offered in
// the deck builder's empty-search path next to the official-Set proposal CTA: a combo needs
// no review because it doesn't assert "this is a real retail product".
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

interface CreatedBuild {
  id: string
  type: 'ATTACK' | 'DEFENSE' | 'STAMINA' | 'BALANCE'
  name: string | null
  isOfficialSet: boolean
  blade: { id: string; name: string; imageId: string | null }
  ratchet: { id: string; name: string }
  bit: { id: string; name: string }
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
        <label htmlFor={`combo-${slot.key}`} className="sr-only">{slot.label} suchen</label>
        <Input
          id={`combo-${slot.key}`}
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

export function BuildComboForm({ onCreated }: { onCreated: (build: CreatedBuild) => void }) {
  const [parts, setParts] = useState<Record<string, PartOption | null>>({ bladeId: null, ratchetId: null, bitId: null })
  const [type, setType] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!parts.bladeId || !parts.ratchetId || !parts.bitId) {
      setError('Bitte wähle je ein Blade, Ratchet und Bit.')
      return
    }
    setBusy(true)
    setError(null)
    const res = await fetch('/api/builds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bladeId: parts.bladeId.id,
        ratchetId: parts.ratchetId.id,
        bitId: parts.bitId.id,
        type: type === '' ? null : type,
      }),
    })
    setBusy(false)
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      setError(errorMessage(body?.error ?? 'unknown'))
      return
    }
    const body = (await res.json()) as { build: CreatedBuild }
    onCreated(body.build)
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm text-current/60">
        Deine Kombination ist nicht im Katalog? Lege sie als persönlichen Build an — ohne Prüfung, da es kein offizielles Set behauptet.
      </p>
      {SLOTS.map((slot) => (
        <FormField key={slot.key} label={slot.label}>
          <SlotPicker slot={slot} value={parts[slot.key]} onChange={(p) => setParts((v) => ({ ...v, [slot.key]: p }))} />
        </FormField>
      ))}
      <FormField label="Bey-Typ (optional)">
        <Select value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">— (Standard: Angriff)</option>
          <option value="ATTACK">Angriff</option>
          <option value="DEFENSE">Verteidigung</option>
          <option value="STAMINA">Ausdauer</option>
          <option value="BALANCE">Balance</option>
        </Select>
      </FormField>
      {error && <p role="alert" className="text-sm text-type-attack">{error}</p>}
      <Button type="submit" disabled={busy || !parts.bladeId || !parts.ratchetId || !parts.bitId}>
        Eigenen Build anlegen
      </Button>
    </form>
  )
}
