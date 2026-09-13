// components/admin/EditToggle.tsx (RC16 #108)
// "Bearbeiten"-Toggle fuer Detailseiten: rendert den Kinde-Inhalt (Kuratoren-Formular) erst
// nach Klick, damit die oeffentliche Detailseite nicht permanent das Edit-UI mitschleift.
// Server-Komponenten uebergeben das Formular als Children; Sichtbarkeit entscheidet allein
// die Seite (Role-Gate), dieser Toggle nur die Interaktion.
'use client'

import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'

export function EditToggle({ label = 'Bearbeiten', children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="space-y-3">
      <Button variant="secondary" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? 'Schließen' : label}
      </Button>
      {open && children}
    </div>
  )
}
