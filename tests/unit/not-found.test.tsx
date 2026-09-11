// tests/unit/not-found.test.tsx (RC10 #30)
// The custom 404 must be a German, branded offramp — not the generic Next.js dead end:
// heading, short explanation, and links back to Home, Events and Search.
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import NotFound from '@/app/not-found'

describe('Custom 404 page (#30)', () => {
  it('explains the situation in German', () => {
    render(<NotFound />)
    expect(screen.getByRole('heading', { name: 'Seite nicht gefunden' })).toBeInTheDocument()
    expect(screen.getByText(/diese seite existiert nicht/i)).toBeInTheDocument()
  })

  it('offers links to Home, Events and Search', () => {
    render(<NotFound />)
    const nav = screen.getByRole('navigation', { name: 'Weitere Seiten' })
    expect(nav).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Zur Startseite' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'Events entdecken' })).toHaveAttribute('href', '/events')
    expect(screen.getByRole('link', { name: 'Suche' })).toHaveAttribute('href', '/search')
  })
})
