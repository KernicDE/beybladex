// tests/unit/not-found.test.tsx (RC10 #30, RC14 #17)
// The custom 404 must be a localized, branded offramp — not the generic Next.js dead end:
// heading, short explanation, and links back to Home, Events and Search. The page wrapper
// (app/not-found.tsx) only resolves the request dictionary; the content component under test
// takes it as a prop, so the assertions here run synchronously against real dictionaries.
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { NotFoundContent } from '@/components/not-found/NotFoundContent'
import deMessages from '@/lib/i18n/messages/de.json'
import enMessages from '@/lib/i18n/messages/en.json'

describe('Custom 404 page (#30)', () => {
  it('explains the situation in German', () => {
    render(<NotFoundContent t={deMessages} />)
    expect(screen.getByRole('heading', { name: 'Seite nicht gefunden' })).toBeInTheDocument()
    expect(screen.getByText(/diese seite existiert nicht/i)).toBeInTheDocument()
  })

  it('offers links to Home, Events and Search', () => {
    render(<NotFoundContent t={deMessages} />)
    const nav = screen.getByRole('navigation', { name: 'Weitere Seiten' })
    expect(nav).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Zur Startseite' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'Events entdecken' })).toHaveAttribute('href', '/events')
    expect(screen.getByRole('link', { name: 'Suche' })).toHaveAttribute('href', '/search')
  })

  it('renders localized when the request dictionary is English (RC14 #17)', () => {
    render(<NotFoundContent t={enMessages} />)
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'Search' })).toHaveAttribute('href', '/search')
  })
})
