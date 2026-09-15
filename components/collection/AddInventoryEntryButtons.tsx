// components/collection/AddInventoryEntryButtons.tsx (Issue #188 Teil 3/3)
// "Mein Inventar" bekommt zwei getrennte Einstiegspunkte statt eines einzigen "?neu=1", der
// bisher IMMER beide Formulare gleichzeitig zeigte:
//   - "+ Teil" → CollectionItemForm ("Einzelnes Teil hinzufügen")
//   - "+ Beyblade" → MarkSetPurchasedForm ("Beyblade als gekauft markieren" — nicht mehr "Set",
//     dasselbe Formular, nur die Überschrift/Beschriftung geändert)
// Beide Formulare rufen bei Erfolg selbst router.refresh() (kein onDone-Callback vorhanden) —
// das Overlay bleibt bewusst offen (man will oft mehrere Teile hintereinander erfassen), ein
// zweiter Klick auf denselben Button schließt es wieder.
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { CollectionItemForm } from '@/components/collection/CollectionItemForm'
import { MarkSetPurchasedForm } from '@/components/collection/MarkSetPurchasedForm'

type Open = 'TEIL' | 'BEYBLADE' | null

export function AddInventoryEntryButtons({
  addSingleLabel,
  markSetLabel,
}: {
  addSingleLabel: string
  markSetLabel: string
}) {
  const [open, setOpen] = useState<Open>(null)
  const toggle = (which: Exclude<Open, null>) => setOpen((current) => (current === which ? null : which))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Button variant={open === 'TEIL' ? 'primary' : 'secondary'} size="sm" onClick={() => toggle('TEIL')}>
          + Teil
        </Button>
        <Button variant={open === 'BEYBLADE' ? 'primary' : 'secondary'} size="sm" onClick={() => toggle('BEYBLADE')}>
          + Beyblade
        </Button>
      </div>
      {open === 'TEIL' && (
        <Card>
          <h3 className="mb-3 text-sm font-semibold">{addSingleLabel}</h3>
          <CollectionItemForm />
        </Card>
      )}
      {open === 'BEYBLADE' && (
        <Card>
          <h3 className="mb-3 text-sm font-semibold">{markSetLabel}</h3>
          <MarkSetPurchasedForm />
        </Card>
      )}
    </div>
  )
}
