// tests/unit/add-inventory-entry-buttons.test.tsx (Issue #188 Teil 3/3)
// "Mein Inventar" bekommt zwei getrennte Einstiegspunkte statt des früheren gemeinsamen
// "?neu=1"-Reveals, das immer BEIDE Formulare gleichzeitig zeigte. Pinnt: jeder Button öffnet
// nur sein eigenes Formular, ein zweiter Klick schließt wieder, die Überschriften kommen aus
// den (jetzt umbenannten, siehe lib/i18n/messages/de.json) Labels.
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { AddInventoryEntryButtons } from '@/components/collection/AddInventoryEntryButtons'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ parts: [] }), { status: 200 })))

describe('AddInventoryEntryButtons (#188)', () => {
  it('"+ Teil" öffnet NUR CollectionItemForm (Einzelnes Teil hinzufügen)', () => {
    render(<AddInventoryEntryButtons addSingleLabel="Einzelnes Teil hinzufügen" markSetLabel="Beyblade als gekauft markieren" />)
    fireEvent.click(screen.getByRole('button', { name: '+ Teil' }))
    expect(screen.getByRole('heading', { name: 'Einzelnes Teil hinzufügen' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Beyblade als gekauft markieren' })).not.toBeInTheDocument()
  })

  it('"+ Beyblade" öffnet NUR MarkSetPurchasedForm, mit dem umbenannten Titel', () => {
    render(<AddInventoryEntryButtons addSingleLabel="Einzelnes Teil hinzufügen" markSetLabel="Beyblade als gekauft markieren" />)
    fireEvent.click(screen.getByRole('button', { name: '+ Beyblade' }))
    expect(screen.getByRole('heading', { name: 'Beyblade als gekauft markieren' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Einzelnes Teil hinzufügen' })).not.toBeInTheDocument()
  })

  it('wechselt von einem Formular zum anderen, ohne beide gleichzeitig zu zeigen', () => {
    render(<AddInventoryEntryButtons addSingleLabel="Einzelnes Teil hinzufügen" markSetLabel="Beyblade als gekauft markieren" />)
    fireEvent.click(screen.getByRole('button', { name: '+ Teil' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Beyblade' }))
    expect(screen.getByRole('heading', { name: 'Beyblade als gekauft markieren' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Einzelnes Teil hinzufügen' })).not.toBeInTheDocument()
  })

  it('ein zweiter Klick auf denselben Button schließt das Formular wieder', () => {
    render(<AddInventoryEntryButtons addSingleLabel="Einzelnes Teil hinzufügen" markSetLabel="Beyblade als gekauft markieren" />)
    fireEvent.click(screen.getByRole('button', { name: '+ Teil' }))
    expect(screen.getByRole('heading', { name: 'Einzelnes Teil hinzufügen' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '+ Teil' }))
    expect(screen.queryByRole('heading', { name: 'Einzelnes Teil hinzufügen' })).not.toBeInTheDocument()
  })
})
