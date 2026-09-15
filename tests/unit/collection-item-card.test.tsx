// tests/unit/collection-item-card.test.tsx (#160; #188 — Redesign 2)
// Redesign: Herkunft (sourceBeyblade) im Vordergrund statt Preis/Händler, Drehrichtungs-Marker,
// Hauptlink auf /parts/[id] statt /collection/item/[id]; der Bearbeiten-Link bleibt separat
// und respektiert `editable` (false auf /collection/[username] — read-only fremde Sammlung).
// #188 — die ganze Karte ist jetzt EIN Link auf /parts/[id] (stretched-link-Pattern, siehe die
// Komponente), Hersteller/Drehrichtung rendern als abgekürzter Marker (CatalogThumb) statt als
// volle Badges.
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { CollectionItemCard, type CollectionItemCardData } from '@/components/collection/CollectionItemCard'

function item(overrides: Partial<CollectionItemCardData> = {}): CollectionItemCardData {
  return {
    id: 'ci1',
    purchasePrice: 19.99,
    currency: 'EUR',
    merchant: 'Testladen',
    boughtAt: new Date('2026-09-01'),
    sourceBeybladeId: 'bey1',
    sourceBeyblade: { id: 'bey1', name: 'Dranzer' },
    part: { id: 'p1', name: 'Flat', category: 'BIT', manufacturer: 'TT', imageId: null, spinDirection: 'RIGHT' },
    ...overrides,
  }
}

const RATES = { EUR: 1 }

describe('CollectionItemCard (#160)', () => {
  it('zeigt die Herkunft (Beyblade-Link) und die ganze Karte verlinkt auf /parts/[id]', () => {
    render(<CollectionItemCard item={item()} rates={RATES} stale={false} target="EUR" />)
    expect(screen.getByRole('link', { name: 'Dranzer' })).toHaveAttribute('href', '/beyblades/bey1')
    // #188 — EIN Vollflächen-Link auf die Teile-Seite (stretched-link), kein zweiter Bild-Link
    // mehr. Der Titel folgt derselben Bit-Kurzform wie überall sonst — „F (Flat)".
    expect(screen.getByRole('link', { name: 'F (Flat)' })).toHaveAttribute('href', '/parts/p1')
  })

  it('"Einzeln hinzugefügt" ohne sourceBeyblade', () => {
    render(<CollectionItemCard item={item({ sourceBeyblade: null, sourceBeybladeId: null })} rates={RATES} stale={false} target="EUR" />)
    expect(screen.getByText('Einzeln hinzugefügt')).toBeInTheDocument()
  })

  it('zeigt Hersteller/Drehrichtung als abgekürzten Marker unter dem Bild (#188)', () => {
    render(<CollectionItemCard item={item()} rates={RATES} stale={false} target="EUR" />)
    expect(screen.getByTitle('Takara Tomy')).toHaveTextContent('TT')
    expect(screen.getByTitle('Rechtsdrehend')).toHaveTextContent('R')
  })

  it('Bearbeiten-Link standardmäßig sichtbar, verschwindet mit editable=false', () => {
    const { rerender } = render(<CollectionItemCard item={item()} rates={RATES} stale={false} target="EUR" />)
    expect(screen.getByRole('link', { name: 'Bearbeiten' })).toHaveAttribute('href', '/collection/item/ci1')

    rerender(<CollectionItemCard item={item()} rates={RATES} stale={false} target="EUR" editable={false} />)
    expect(screen.queryByRole('link', { name: 'Bearbeiten' })).not.toBeInTheDocument()
  })
})
