// components/beyblade/DeckDeleteButton.tsx (#164)
// Löscht ein eigenes Deck — DELETE /api/decks/[id] (Server-Gate: userId, wie PATCH). Gleiches
// Idiom wie components/beyblade/BuildDeleteButton.tsx (#161): window.confirm() vor dem
// irreversiblen Löschen.
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { errorMessage } from '@/lib/errorCopy'

export function DeckDeleteButton({ deckId }: { deckId: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function del() {
    if (!window.confirm('Dieses Deck endgültig löschen? Das kann nicht rückgängig gemacht werden.')) return
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/decks/${deckId}`, { method: 'DELETE' })
    if (!res.ok) {
      setBusy(false)
      setError(errorMessage((await res.json().catch(() => null))?.error ?? 'unknown'))
      return
    }
    router.push('/decks')
    router.refresh()
  }

  return (
    <div className="space-y-1">
      <Button type="button" variant="danger" size="sm" onClick={del} disabled={busy}>
        {busy ? 'Lösche…' : 'Deck löschen'}
      </Button>
      {error && <p role="alert" className="text-sm text-type-attack">{error}</p>}
    </div>
  )
}
