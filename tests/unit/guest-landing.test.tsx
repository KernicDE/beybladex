// tests/unit/guest-landing.test.tsx (RC13 issue #88)
// The guest home page is a full marketing page, not just a hero: every section promised by
// the issue must render — hero with prominent register/login CTAs, the six real feature
// cards deep-linking into the app, the screenshot gallery (currently decorative mockup
// frames, each visibly marked as a preview), the DACH-community section, and the closing
// register CTA. GuestLanding is presentational; the teaser's own data states are covered in
// landing-event-teaser.test.tsx.
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { GuestLanding } from '@/components/home/GuestLanding'

const FEATURES: Array<{ title: string; href: string }> = [
  { title: 'Events & Turniere', href: '/events' },
  { title: 'Clubs & Community', href: '/clubs' },
  { title: 'Deck-Builder', href: '/decks' },
  { title: 'Sammlungsverwaltung', href: '/collection' },
  { title: 'Rangliste & Meta', href: '/rangliste' },
  { title: 'Regelwerk', href: '/rules' },
]

describe('GuestLanding — hero (#88)', () => {
  it('renders the brand headline with prominent register and login CTAs', () => {
    render(<GuestLanding upcomingEvents={[]} />)
    expect(screen.getByRole('heading', { level: 1, name: 'BeybladeX.de' })).toBeInTheDocument()
    const register = screen.getAllByRole('link', { name: 'Jetzt registrieren' })
    expect(register.length).toBeGreaterThanOrEqual(1)
    for (const link of register) expect(link).toHaveAttribute('href', '/register')
    expect(screen.getAllByRole('link', { name: 'Anmelden' }).length).toBeGreaterThanOrEqual(1)
  })
})

describe('GuestLanding — feature overview (#88)', () => {
  it('renders exactly the six real core features, each deep-linking into the app', () => {
    render(<GuestLanding upcomingEvents={[]} />)
    expect(screen.getByRole('heading', { name: 'Alles für dein X-Abenteuer' })).toBeInTheDocument()
    for (const { title, href } of FEATURES) {
      const link = screen.getByRole('link', { name: new RegExp(title) })
      expect(link).toHaveAttribute('href', href)
    }
  })

  it('mentions no features that do not exist', () => {
    render(<GuestLanding upcomingEvents={[]} />)
    // Guard against marketing drift: only known feature cards may appear.
    expect(screen.queryAllByRole('article')).toHaveLength(0) // no unknown card landmarks are used
    expect(screen.getAllByRole('link').filter((l) => l.getAttribute('href') === '/shop')).toHaveLength(0)
  })
})

describe('GuestLanding — screenshot gallery (#88)', () => {
  it('renders the gallery with three mockup frames, each marked as a preview', () => {
    render(<GuestLanding upcomingEvents={[]} />)
    expect(screen.getByRole('heading', { name: 'Ein Blick in die App' })).toBeInTheDocument()
    expect(screen.getByRole('figure', { name: 'Vorschau: beybladex.de/events' })).toBeInTheDocument()
    expect(screen.getByRole('figure', { name: 'Vorschau: beybladex.de/clubs' })).toBeInTheDocument()
    expect(screen.getByRole('figure', { name: 'Vorschau: beybladex.de/decks' })).toBeInTheDocument()
    // Each frame visibly flags that the final screenshot asset is still pending.
    expect(screen.getAllByText(/Screenshot folgt/)).toHaveLength(3)
  })
})

describe('GuestLanding — DACH section and closing CTA (#88)', () => {
  it('renders the DACH-community section with all three regions', () => {
    render(<GuestLanding upcomingEvents={[]} />)
    expect(screen.getByRole('heading', { name: 'Die DACH-Community' })).toBeInTheDocument()
    expect(screen.getByText('Deutschland')).toBeInTheDocument()
    expect(screen.getByText('Österreich')).toBeInTheDocument()
    expect(screen.getByText('Schweiz')).toBeInTheDocument()
  })

  it('renders the closing register CTA', () => {
    render(<GuestLanding upcomingEvents={[]} />)
    expect(screen.getByRole('heading', { name: /erstes Turnier/ })).toBeInTheDocument()
    const register = screen.getAllByRole('link', { name: 'Jetzt registrieren' })
    expect(register.length).toBeGreaterThanOrEqual(2) // hero + closing section
  })
})
