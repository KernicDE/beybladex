// components/admin/SeasonCreateForm.tsx (Phase 14)
// ADMIN-only season creation. If an ACTIVE season already exists, its id is passed as
// `activeSeasonId` and sent as `completePreviousSeasonId` — the API completes it and seeds
// regressed ratings for the new season atomically (lib/elo.ts's regressToMean).
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'

export function SeasonCreateForm({ activeSeasonId }: { activeSeasonId: string | null }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)
    const res = await fetch('/api/admin/seasons', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        startsAt: new Date(startsAt).toISOString(),
        endsAt: new Date(endsAt).toISOString(),
        ...(activeSeasonId ? { completePreviousSeasonId: activeSeasonId } : {}),
      }),
    })
    setPending(false)
    if (res.ok) {
      setName('')
      setStartsAt('')
      setEndsAt('')
      router.refresh()
    } else {
      const body = await res.json().catch(() => null)
      setError(body?.error ?? `Fehler (${res.status})`)
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {activeSeasonId && (
        <p className="text-xs text-current/60">
          Eine neue Season schließt die aktuell aktive Season automatisch ab und setzt jede
          bewertete Elo-Zahl auf 75&nbsp;% des alten Werts + 25&nbsp;% Basiswert (1000) zurück.
        </p>
      )}
      <FormField label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Season 2 – Sommer 2026" maxLength={100} required />
      </FormField>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField label="Start">
          <Input type="date" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required />
        </FormField>
        <FormField label="Ende">
          <Input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required />
        </FormField>
      </div>
      {error && <p role="alert" className="text-sm text-type-attack">{error}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? 'Erstelle…' : activeSeasonId ? 'Aktuelle Season abschließen & neue starten' : 'Season starten'}
      </Button>
    </form>
  )
}
