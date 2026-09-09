// components/collection/CollectionDeleteButton.tsx
// Owner-only delete of a CollectionItem (DELETE /api/collection/[id]). Confirms first —
// the click also cascade-deletes the item's PricePoints.
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'

export function CollectionDeleteButton({ itemId }: { itemId: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function remove() {
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/collection/${itemId}`, { method: 'DELETE' })
    setBusy(false)
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      setError(body?.error ?? `Fehler (${res.status})`)
      setConfirming(false)
      return
    }
    router.push('/collection')
    router.refresh()
  }

  return (
    <div className="space-y-1">
      {confirming ? (
        <div className="flex items-center gap-2">
          <span className="text-sm">Wirklich löschen? Der Preisverlauf geht mit.</span>
          <Button variant="danger" size="sm" onClick={remove} disabled={busy}>Ja, löschen</Button>
          <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={busy}>Abbrechen</Button>
        </div>
      ) : (
        <Button variant="danger" size="sm" onClick={() => setConfirming(true)}>Eintrag löschen</Button>
      )}
      {error && <p role="alert" className="text-sm text-type-attack">{error}</p>}
    </div>
  )
}
