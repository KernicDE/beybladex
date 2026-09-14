// components/beyblade/BuildTitleEditable.tsx (#161)
// Ersetzt die frühere separate "Build bearbeiten"-Box (BuildEditForm) durch einen echten
// Inline-Edit-Modus: im Lesemodus zeigt dieselbe Komponente Titel + Typ-Badge wie bisher; ein
// "Bearbeiten"-Klick verwandelt genau diese Überschrift/dieses Badge in Eingabefelder statt
// eine zusätzliche Box darunter zu öffnen. Nur die Erstellerin bzw. der Ersteller sieht den
// Bearbeiten-Button überhaupt (Server-Gate bleibt PATCH /api/builds/[id] — 404 für alle
// anderen). PATCH-Vertrag unverändert: leerer Name → null → kanonischer Name aus den Teilen;
// type ist NOT NULL, verlangt immer einen der vier Enum-Werte (siehe die Route für Details).
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { TypeBadge } from '@/components/beyblade/TypeBadge'
import { errorMessage } from '@/lib/errorCopy'
import type { BeyType } from '@prisma/client'

const TYPES: { value: BeyType; label: string }[] = [
  { value: 'ATTACK', label: 'Angriff' },
  { value: 'DEFENSE', label: 'Verteidigung' },
  { value: 'STAMINA', label: 'Ausdauer' },
  { value: 'BALANCE', label: 'Balance' },
]

export function BuildTitleEditable({
  buildId,
  displayName,
  initialName,
  initialType,
}: {
  buildId: string
  /** Anzeigename im Lesemodus — bereits server-seitig auf den kanonischen Namen zurückgefallen. */
  displayName: string
  /** Rohwert für das Eingabefeld — leer, wenn kein eigener Name gesetzt ist. */
  initialName: string
  initialType: BeyType
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(initialName)
  const [type, setType] = useState<BeyType>(initialType)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function cancel() {
    setName(initialName)
    setType(initialType)
    setError(null)
    setEditing(false)
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/builds/${buildId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type }),
    })
    setBusy(false)
    if (!res.ok) {
      setError(errorMessage((await res.json().catch(() => null))?.error ?? 'unknown'))
      return
    }
    setEditing(false)
    router.refresh()
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold">{displayName}</h1>
        <div className="flex items-center gap-2">
          <TypeBadge type={type} />
          <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
            Bearbeiten
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={save} className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[220px] flex-1">
          <label htmlFor="build-name-edit" className="mb-1 block text-xs text-current/60">
            Name (leer = kanonischer Name aus den Teilen)
          </label>
          <Input
            id="build-name-edit"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="text-lg font-semibold"
            maxLength={160}
            autoFocus
          />
        </div>
        <div>
          <label htmlFor="build-type-edit" className="mb-1 block text-xs text-current/60">Typ</label>
          <Select id="build-type-edit" value={type} onChange={(e) => setType(e.target.value as BeyType)}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </Select>
        </div>
      </div>
      {error && <p role="alert" className="text-sm text-type-attack">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Speichere…' : 'Speichern'}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={cancel} disabled={busy}>
          Abbrechen
        </Button>
      </div>
    </form>
  )
}
