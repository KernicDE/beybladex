// components/beyblade/DeckVisibilityToggle.tsx (MVP4/4, #144)
// Öffentlich/Ungelistet-Umschalter am Deck — nur der Besitzer sieht ihn (Server-Gate:
// PATCH /api/decks/[id] antwortet 404 für fremde Decks). Ungelistet heißt niemals geheim:
// per Direktlink und in Turnieren bleibt das Deck sichtbar (#139). Labels kommen als Props
// aus dem Request-Dictionary (Idiom wie EventsFilterBar).
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'

export interface DeckVisibilityLabels {
  publicBadge: string
  unlistedBadge: string
  switchToPublic: string
  switchToUnlisted: string
  hint: string
  errorPrefix: string
}

export function DeckVisibilityToggle({ deckId, initial, labels }: { deckId: string; initial: 'PUBLIC' | 'UNLISTED'; labels: DeckVisibilityLabels }) {
  const router = useRouter()
  const [visibility, setVisibility] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle(next: 'PUBLIC' | 'UNLISTED') {
    if (next === visibility || busy) return
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/decks/${deckId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visibility: next }),
    })
    if (!res.ok) {
      setBusy(false)
      setError(`${labels.errorPrefix} (${res.status})`)
      return
    }
    setVisibility(next)
    setBusy(false)
    router.refresh()
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Badge tone={visibility === 'PUBLIC' ? 'cyan' : 'neutral'}>
          {visibility === 'PUBLIC' ? labels.publicBadge : labels.unlistedBadge}
        </Badge>
        <button
          type="button"
          onClick={() => toggle(visibility === 'PUBLIC' ? 'UNLISTED' : 'PUBLIC')}
          disabled={busy}
          className="rounded-md border border-current/30 px-3 py-1 text-xs font-medium transition-colors hover:bg-current/5 disabled:opacity-50"
        >
          {visibility === 'PUBLIC' ? labels.switchToUnlisted : labels.switchToPublic}
        </button>
      </div>
      <p className="text-xs text-current/50">{labels.hint}</p>
      {error && <p role="alert" className="text-sm text-type-attack">{error}</p>}
    </div>
  )
}
