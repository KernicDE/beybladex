// tests/unit/catalog-thumb.test.tsx (Issue #188)
// Shared image block for the Sammlung page's three tabs: manufacturer marker flush LEFT under
// the image, spin-direction marker flush RIGHT — both abbreviated (TT/H, R/L), replacing the
// previous full-word badges. `justify-between` inside a wrapper exactly as wide as the image is
// what produces the left/right alignment; this test pins the abbreviations and the "no spin
// direction known" fallback rather than the CSS itself (jsdom has no real layout).
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { CatalogThumb } from '@/components/beyblade/CatalogThumb'

describe('CatalogThumb (#188)', () => {
  it('zeigt TT/H für Takara Tomy/Hasbro, abgekürzt', () => {
    const { rerender } = render(<CatalogThumb imageId={null} alt="" manufacturer="TT" spinDirection="RIGHT" />)
    expect(screen.getByTitle('Takara Tomy')).toHaveTextContent('TT')

    rerender(<CatalogThumb imageId={null} alt="" manufacturer="HASBRO" spinDirection="RIGHT" />)
    expect(screen.getByTitle('Hasbro')).toHaveTextContent('H')
  })

  it('zeigt R/L für Rechts-/Linksdrehend, abgekürzt', () => {
    const { rerender } = render(<CatalogThumb imageId={null} alt="" manufacturer="TT" spinDirection="RIGHT" />)
    expect(screen.getByTitle('Rechtsdrehend')).toHaveTextContent('R')

    rerender(<CatalogThumb imageId={null} alt="" manufacturer="TT" spinDirection="LEFT" />)
    expect(screen.getByTitle('Linksdrehend')).toHaveTextContent('L')
  })

  it('lässt den Drehrichtungs-Marker weg, wenn keine Drehrichtung bekannt ist (z. B. Set ohne verifiziertes Blade)', () => {
    render(<CatalogThumb imageId={null} alt="" manufacturer="TT" spinDirection={null} />)
    expect(screen.queryByTitle('Rechtsdrehend')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Linksdrehend')).not.toBeInTheDocument()
    // Der Hersteller-Marker bleibt trotzdem da.
    expect(screen.getByTitle('Takara Tomy')).toBeInTheDocument()
  })
})
