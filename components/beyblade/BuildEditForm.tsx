// components/beyblade/BuildEditForm.tsx (MVP4/5, #145)
// Name/Typ-Bearbeitung für die ERSTELLERIN bzw. den Ersteller eines Builds (PATCH
// /api/builds/[id] — Server-Gate: creatorId, für alle anderen 404). Leerer Name → null →
// die Anzeige fällt auf den kanonisch abgeleiteten Namen zurück. Typ ist NOT NULL in der DB
// (kein "abgeleitet"-Leerzustand wie bei name) — die Auswahl bietet daher immer einen der
// vier Enum-Werte an, vorbelegt mit dem aktuellen Typ. Deutsch-hardcoded (Idiom der
// Build-Detailseite, wie BuildVisibilityToggle).
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { errorMessage } from '@/lib/errorCopy'

export function BuildEditForm({
  buildId,
  initial,
}: {
  buildId: string
  initial: { name: string; type: string }
}) {
  const router = useRouter()
  const [name, setName] = useState(initial.name)
  const [type, setType] = useState(initial.type)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit(e: React.FormEvent) {
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
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      setError(errorMessage(body?.error ?? 'unknown'))
      return
    }
    setDone(true)
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Name (leer = kanonischer Name aus den Teilen)">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={160} />
        </FormField>
        <FormField label="Bey-Typ">
          <Select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="ATTACK">Angriff</option>
            <option value="DEFENSE">Verteidigung</option>
            <option value="STAMINA">Ausdauer</option>
            <option value="BALANCE">Balance</option>
          </Select>
        </FormField>
      </div>
      {error && <p role="alert" className="text-sm text-type-attack">{error}</p>}
      {done && !busy && <p className="text-sm text-current/60">Gespeichert.</p>}
      <Button type="submit" disabled={busy}>
        Speichern
      </Button>
    </form>
  )
}
