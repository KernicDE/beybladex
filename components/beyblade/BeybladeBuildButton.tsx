// components/beyblade/BeybladeBuildButton.tsx (MVP4/4, #144)
// "Build daraus erstellen" auf der Beyblade-Detailseite: legt über die bestehende Build-Create-
// API (POST /api/builds) einen persönlichen Build mit denselben 7 Teilen an und redirected
// auf den neuen Build. Die API dedupliziert die Kombination (NULL-sicherer Combo-Key) — ein
// bereits existierender Build wird zurückgegeben statt neu angelegt. Erfordert Login (die
// Detailseite rendert den Button nur für angemeldete User). Deutsche Labels per Prop
// (Katalog-Oberflächen sind Deutsch-hardcoded, Idiom der Detailseite).
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'

export interface BeybladeBuildParts {
  bladeId: string | null
  lockChipId: string | null
  overBladeId: string | null
  metalBladeId: string | null
  assistBladeId: string | null
  ratchetId: string | null
  bitId: string
}

export function BeybladeBuildButton({ parts, label, errorLabel }: { parts: BeybladeBuildParts; label: string; errorLabel: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    setBusy(true)
    setError(null)
    const res = await fetch('/api/builds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parts),
    })
    if (!res.ok) {
      setBusy(false)
      const body = (await res.json().catch(() => null)) as { error?: string } | null
      setError(body?.error ?? `${errorLabel} (${res.status})`)
      return
    }
    const { id } = (await res.json()) as { id: string }
    router.push(`/builds/${id}`)
    router.refresh()
  }

  return (
    <div className="space-y-1">
      <Button onClick={create} disabled={busy}>{label}</Button>
      {error && <p role="alert" className="text-sm text-type-attack">{error}</p>}
    </div>
  )
}
