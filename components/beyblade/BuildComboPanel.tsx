// components/beyblade/BuildComboPanel.tsx (RC16 #104)
// "Neuer Build"-Verpackung fuer /builds: oeffnet die bestehende BuildComboForm hinter dem
// ?neu=1-CTA ( dieselbe Konvention wie /collection?neu=1) und leitet nach dem Anlegen direkt
// auf die Detailseite des neuen Builds weiter.
'use client'

import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/Card'
import { BuildComboForm } from '@/components/beyblade/BuildComboForm'

export function BuildComboPanel() {
  const router = useRouter()
  return (
    <Card>
      <h3 className="mb-3 text-sm font-semibold">Neuer Build</h3>
      <BuildComboForm onCreated={(build) => router.push(`/builds/${build.id}`)} />
    </Card>
  )
}
