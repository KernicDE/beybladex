// components/beyblade/BuildVisibilityToggle.tsx (MVP4/4, #144)
// Öffentlich/Ungelistet-Umschalter für Builds — nur die ERSTELLERIN bzw. der Ersteller des
// Builds sieht ihn (Server-Gate: PATCH /api/builds/[id] antwortet 404 für alle anderen).
// Deutsch-hardcoded (Idiom der Build-Detailseite, wie die anderen Sections dort).
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'

export function BuildVisibilityToggle({ buildId, initial }: { buildId: string; initial: 'PUBLIC' | 'UNLISTED' }) {
  const router = useRouter()
  const [visibility, setVisibility] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function toggle(next: 'PUBLIC' | 'UNLISTED') {
    if (next === visibility || busy) return
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/builds/${buildId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visibility: next }),
    })
    if (!res.ok) {
      setBusy(false)
      setError(`Speichern fehlgeschlagen (${res.status})`)
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
          {visibility === 'PUBLIC' ? 'Öffentlich' : 'Ungelistet'}
        </Badge>
        <button
          type="button"
          onClick={() => toggle(visibility === 'PUBLIC' ? 'UNLISTED' : 'PUBLIC')}
          disabled={busy}
          className="rounded-md border border-current/30 px-3 py-1 text-xs font-medium transition-colors hover:bg-current/5 disabled:opacity-50"
        >
          {visibility === 'PUBLIC' ? 'Auf unlisted setzen' : 'Öffentlich listen'}
        </button>
      </div>
      <p className="text-xs text-current/50">
        Öffentliche Builds erscheinen in der Ansicht „Öffentliche Builds“. Ungelistete Builds
        bleiben per Direktlink sichtbar — niemals geheim.
      </p>
      {error && <p role="alert" className="text-sm text-type-attack">{error}</p>}
    </div>
  )
}
