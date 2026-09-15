// components/collection/AddCatalogEntryToggle.tsx (Issue #188)
// The "+" entry point for the Sammlung page's Beyblades/Teile tabs — a two-tier split:
//   - TRUSTED/ADMIN ("Vertrauensperson"/Admin): "+ Beyblade/Teil ANLEGEN" — direct create,
//     visible in the catalog immediately (BeybladeForm/PartForm, same forms the curator
//     admin surfaces already use).
//   - everyone else logged in: "+ Beyblade/Teil EINREICHEN" — a CatalogProposal, invisible
//     until a curator approves it (CatalogProposalForm, Phase 11's existing review flow).
// `canAuthor` is computed server-side by the page (same TRUSTED/ADMIN check as
// app/parts/[id]/page.tsx's own canAuthor) and passed in — this component only decides which
// form to render, never the authorization itself (the server routes are the actual gate).
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { BeybladeForm } from '@/components/admin/BeybladeForm'
import { PartForm } from '@/components/admin/PartForm'
import { CatalogProposalForm } from '@/components/proposals/CatalogProposalForm'

export function AddCatalogEntryToggle({ kind, canAuthor }: { kind: 'BEYBLADE' | 'PART'; canAuthor: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const noun = kind === 'BEYBLADE' ? 'Beyblade' : 'Teil'
  const verb = canAuthor ? 'anlegen' : 'einreichen'

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        + {noun} {verb}
      </Button>
    )
  }

  return (
    <Card>
      <h3 className="mb-3 text-sm font-semibold">{noun} {verb}</h3>
      {canAuthor ? (
        kind === 'BEYBLADE' ? (
          <BeybladeForm onCreated={(b) => router.push(`/beyblades/${b.id}`)} />
        ) : (
          <PartForm onCreated={() => setOpen(false)} />
        )
      ) : (
        <CatalogProposalForm defaultKind={kind === 'BEYBLADE' ? 'BUILD' : 'PART'} onDone={() => setOpen(false)} />
      )}
      <div className="mt-3">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Abbrechen</Button>
      </div>
    </Card>
  )
}
