// tests/unit/pagination.test.tsx (#155)
// components/ui/Pagination.tsx — 1 [2] 3 … 12 mit ←/→, Lücken-Fenster, Grenzfälle (Seite 1/
// letzte Seite deaktiviert die jeweilige Pfeilrichtung; totalPages<=1 rendert nichts).
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { Pagination } from '@/components/ui/Pagination'

describe('Pagination', () => {
  it('rendert nichts bei totalPages <= 1', () => {
    const { container } = render(<Pagination page={1} totalPages={1} buildHref={(p) => `/x?page=${p}`} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('zeigt 1 [2] 3 auf Seite 2 von 3 — alle Seiten sichtbar, keine Lücke', () => {
    render(<Pagination page={2} totalPages={3} buildHref={(p) => `/x?page=${p}`} />)
    expect(screen.getByRole('link', { name: '1' })).toHaveAttribute('href', '/x?page=1')
    expect(screen.getByText('2')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: '3' })).toHaveAttribute('href', '/x?page=3')
    expect(screen.queryByText('…')).not.toBeInTheDocument()
  })

  it('zeigt Lücken auf Seite 6 von 12: 1 … 5 [6] 7 … 12', () => {
    render(<Pagination page={6} totalPages={12} buildHref={(p) => `/x?page=${p}`} />)
    for (const n of ['1', '5', '7', '12']) {
      expect(screen.getByRole('link', { name: n })).toBeInTheDocument()
    }
    expect(screen.getByText('6')).toHaveAttribute('aria-current', 'page')
    expect(screen.queryAllByText('…')).toHaveLength(2)
    // Seiten 2,3,4 und 8,9,10,11 sind NICHT einzeln verlinkt (nur im Fenster ±1 um die aktuelle).
    expect(screen.queryByRole('link', { name: '3' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '9' })).not.toBeInTheDocument()
  })

  it('deaktiviert ← auf Seite 1 und → auf der letzten Seite', () => {
    const { rerender } = render(<Pagination page={1} totalPages={3} buildHref={(p) => `/x?page=${p}`} />)
    expect(screen.queryByRole('link', { name: 'Vorherige Seite' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Nächste Seite' })).toHaveAttribute('href', '/x?page=2')

    rerender(<Pagination page={3} totalPages={3} buildHref={(p) => `/x?page=${p}`} />)
    expect(screen.getByRole('link', { name: 'Vorherige Seite' })).toHaveAttribute('href', '/x?page=2')
    expect(screen.queryByRole('link', { name: 'Nächste Seite' })).not.toBeInTheDocument()
  })
})
