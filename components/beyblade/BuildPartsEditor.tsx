// components/beyblade/BuildPartsEditor.tsx (#164)
// "Teile ändern" auf der Build-Detailseite. WICHTIG (Produktentscheidung aus #164): eine
// Teile-Änderung mutiert NIEMALS den bestehenden Build — sonst passen dessen Bewertungen/
// Kommentare nicht mehr zur neuen Teile-Kombination. Stattdessen legt sie über dieselbe
// POST /api/builds-Route wie BuildComboForm einen NEUEN Build an (oder findet die bestehende
// Kombination, falls sie schon existiert — die Duplicate-Combo-Erkennung aus #122 greift
// unverändert) und leitet dorthin weiter. Der alte Build bleibt unangetastet bestehen.
// Nur für die Standard-Bauform (Blade+Ratchet+Bit) angeboten — CX-/Ratchet-Integrated-Sets
// sind offizielle Retail-Produkte (siehe BuildComboForm), diese Teile-Kombination ändert man
// nicht über den persönlichen Combo-Weg.
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { BuildComboForm } from '@/components/beyblade/BuildComboForm'

export function BuildPartsEditor({
  currentBuildId,
  initial,
}: {
  currentBuildId: string
  initial: { blade: { id: string; name: string }; ratchet: { id: string; name: string }; bit: { id: string; name: string }; type: string }
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Teile ändern
      </Button>
    )
  }

  return (
    <div className="space-y-3 rounded-xl border border-dashed border-x-cyan/20 p-4">
      <p className="text-sm text-current/60">
        Eine Teile-Änderung legt einen neuen Build an (oder findet einen bestehenden mit dieser
        Kombination) — Bewertungen und Kommentare dieses Builds bleiben unverändert erhalten.
      </p>
      <BuildComboForm
        initial={initial}
        onCreated={(build) => {
          if (build.id === currentBuildId) {
            // Exakt dieselbe Kombination erneut gewählt — nichts zu tun.
            setOpen(false)
            return
          }
          router.push(`/builds/${build.id}`)
        }}
      />
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
        Abbrechen
      </Button>
    </div>
  )
}
