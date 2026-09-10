// components/proposals/CatalogProposalCTA.tsx
// The collapsible entry point (Phase 11, item 1) — "Teil/Set nicht gefunden? Vorschlagen" —
// rendered wherever a part/build search comes up empty (deck builder picker, /builds search,
// CollectionItemForm part lookup, /search). Replaces PartRequestCTA's free-text-only form;
// guests get nothing (the API 401s anyway, and the caller passes loggedIn=false).
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { CatalogProposalForm } from '@/components/proposals/CatalogProposalForm'

export function CatalogProposalCTA({
  defaultKind = 'PART',
  defaultName = '',
  loggedIn = true,
}: {
  defaultKind?: 'PART' | 'BUILD'
  defaultName?: string
  loggedIn?: boolean
}) {
  const [open, setOpen] = useState(false)
  if (!loggedIn) return null
  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Teil/Set nicht gefunden? Vorschlagen
      </Button>
    )
  }
  return (
    <div className="space-y-3 rounded-xl border border-dashed border-x-cyan/20 p-4">
      <CatalogProposalForm defaultKind={defaultKind} defaultName={defaultName} onDone={() => setOpen(false)} />
      <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Abbrechen</Button>
    </div>
  )
}
