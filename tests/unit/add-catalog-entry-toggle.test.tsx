// tests/unit/add-catalog-entry-toggle.test.tsx (Issue #188)
// The "+" entry point on the Sammlung page's Beyblades/Teile tabs: label and form depend on
// `canAuthor` (TRUSTED/ADMIN vs. everyone else logged in) — this pins the branching itself,
// not the wrapped forms' own behavior (BeybladeForm/PartForm/CatalogProposalForm each have —
// or, for the two new ones, will get — their own coverage elsewhere).
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { AddCatalogEntryToggle } from '@/components/collection/AddCatalogEntryToggle'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
// Just needs to render without hitting the network for this test's assertions (no submit here).
vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })))

describe('AddCatalogEntryToggle (#188)', () => {
  it('zeigt "einreichen" + CatalogProposalForm für Nicht-Kurator:innen', () => {
    render(<AddCatalogEntryToggle kind="BEYBLADE" canAuthor={false} />)
    const button = screen.getByRole('button', { name: '+ Beyblade einreichen' })
    fireEvent.click(button)
    expect(screen.getByRole('heading', { name: 'Beyblade einreichen' })).toBeInTheDocument()
    // CatalogProposalForm's eigener kind-Umschalter (Neues Teil/Neues Set) ist der Beweis,
    // dass es tatsächlich diese Komponente ist.
    expect(screen.getByRole('button', { name: 'Neues Set' })).toBeInTheDocument()
  })

  it('zeigt "anlegen" + BeybladeForm für TRUSTED/ADMIN', () => {
    render(<AddCatalogEntryToggle kind="BEYBLADE" canAuthor />)
    fireEvent.click(screen.getByRole('button', { name: '+ Beyblade anlegen' }))
    expect(screen.getByRole('heading', { name: 'Beyblade anlegen' })).toBeInTheDocument()
    expect(screen.getByLabelText('Set-Name')).toBeInTheDocument()
  })

  it('zeigt "einreichen" + CatalogProposalForm (kind PART) für Nicht-Kurator:innen im Teile-Modus', () => {
    render(<AddCatalogEntryToggle kind="PART" canAuthor={false} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Teil einreichen' }))
    expect(screen.getByRole('heading', { name: 'Teil einreichen' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Neues Teil' })).toBeInTheDocument()
  })

  it('zeigt "anlegen" + PartForm für TRUSTED/ADMIN im Teile-Modus', () => {
    render(<AddCatalogEntryToggle kind="PART" canAuthor />)
    fireEvent.click(screen.getByRole('button', { name: '+ Teil anlegen' }))
    expect(screen.getByRole('heading', { name: 'Teil anlegen' })).toBeInTheDocument()
    // PartForm's eigener Submit-Button-Text im Create-Modus.
    expect(screen.getByRole('button', { name: 'Teil anlegen' })).toBeInTheDocument()
  })

  it('"Abbrechen" schließt das Formular wieder', () => {
    render(<AddCatalogEntryToggle kind="PART" canAuthor={false} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Teil einreichen' }))
    expect(screen.getByRole('heading', { name: 'Teil einreichen' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Abbrechen' }))
    expect(screen.queryByRole('heading', { name: 'Teil einreichen' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Teil einreichen' })).toBeInTheDocument()
  })
})
