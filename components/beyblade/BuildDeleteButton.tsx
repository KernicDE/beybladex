// components/beyblade/BuildDeleteButton.tsx (#161)
// Löscht einen eigenen Build — DELETE /api/builds/[id] (Server-Gate: creatorId, wie PATCH
// seit #145). Steckt der Build noch in einem Deck (DeckBuild.buildId ist ON DELETE RESTRICT),
// antwortet die Route 409 build_in_use statt eines rohen 500 — die Fehlermeldung erklärt das.
// window.confirm() vor dem irreversiblen Löschen, gleiches Idiom wie
// components/tournament/OrganizerConsole.tsx.
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { errorMessage } from '@/lib/errorCopy'

export function BuildDeleteButton({ buildId }: { buildId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function del() {
    if (!window.confirm('Diesen Build endgültig löschen? Das kann nicht rückgängig gemacht werden.')) return
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/builds/${buildId}`, { method: 'DELETE' })
    if (!res.ok) {
      setBusy(false)
      setError(errorMessage((await res.json().catch(() => null))?.error ?? 'unknown'))
      return
    }
    router.push('/builds')
    router.refresh()
  }

  return (
    <div className="space-y-1">
      <Button type="button" variant="danger" size="sm" onClick={del} disabled={busy}>
        {busy ? 'Lösche…' : 'Build löschen'}
      </Button>
      {error && <p role="alert" className="text-sm text-type-attack">{error}</p>}
    </div>
  )
}
