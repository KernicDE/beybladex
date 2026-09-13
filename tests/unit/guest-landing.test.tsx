// tests/unit/guest-landing.test.tsx (RC13 issue #88)
// The guest home page is a full marketing page, not just a hero: every section promised by
// the issue must render — hero with prominent register/login CTAs, the six real feature
// cards deep-linking into the app, the screenshot gallery with real production screenshots
// in browser frames, the DACH-community section, and the closing
// register CTA. GuestLanding is presentational; the teaser's own data states are covered in
// landing-event-teaser.test.tsx.
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { GuestLanding } from '@/components/home/GuestLanding'
import deMessages from '@/lib/i18n/messages/de.json'
import enMessages from '@/lib/i18n/messages/en.json'

// RC14 #17 — GuestLanding renders from a request dictionary; tests pin the German copy
// (de.json, the canonical shape) and add one English-render assertion below.
const t = deMessages

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
    render(<GuestLanding upcomingEvents={[]} t={t} />)
    expect(screen.getByRole('heading', { level: 1, name: 'BeybladeX.de' })).toBeInTheDocument()
    const register = screen.getAllByRole('link', { name: 'Jetzt registrieren' })
    expect(register.length).toBeGreaterThanOrEqual(1)
    for (const link of register) expect(link).toHaveAttribute('href', '/register')
    expect(screen.getAllByRole('link', { name: 'Anmelden' }).length).toBeGreaterThanOrEqual(1)
  })
})

describe('GuestLanding — feature overview (#88)', () => {
  it('renders exactly the six real core features, each deep-linking into the app', () => {
    render(<GuestLanding upcomingEvents={[]} t={t} />)
    expect(screen.getByRole('heading', { name: 'Alles für dein X-Abenteuer' })).toBeInTheDocument()
    for (const { title, href } of FEATURES) {
      const link = screen.getByRole('link', { name: new RegExp(title) })
      expect(link).toHaveAttribute('href', href)
    }
  })

  it('mentions no features that do not exist', () => {
    render(<GuestLanding upcomingEvents={[]} t={t} />)
    // Guard against marketing drift: only known feature cards may appear.
    expect(screen.queryAllByRole('article')).toHaveLength(0) // no unknown card landmarks are used
    expect(screen.getAllByRole('link').filter((l) => l.getAttribute('href') === '/shop')).toHaveLength(0)
  })
})

describe('GuestLanding — screenshot gallery (#88)', () => {
  it('renders the gallery with three real screenshots in browser frames', () => {
    render(<GuestLanding upcomingEvents={[]} t={t} />)
    expect(screen.getByRole('heading', { name: 'Ein Blick in die App' })).toBeInTheDocument()
    expect(screen.getByRole('figure', { name: 'Event-Kalender mit DACH-Karte' })).toBeInTheDocument()
    expect(screen.getByRole('figure', { name: 'Clubs & Community' })).toBeInTheDocument()
    expect(screen.getByRole('figure', { name: 'Rangliste & Elo' })).toBeInTheDocument()
    // Each frame shows a real production screenshot with a meaningful alt text.
    expect(screen.getByRole('img', { name: /beybladex\.de\/events/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /beybladex\.de\/clubs/ })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /beybladex\.de\/rangliste/ })).toBeInTheDocument()
    // The old "preview pending" placeholder copy must be gone.
    expect(screen.queryByText(/Screenshot folgt/)).not.toBeInTheDocument()
  })
})

describe('GuestLanding — DACH section and closing CTA (#88)', () => {
  it('renders the DACH-community section with all three regions', () => {
    render(<GuestLanding upcomingEvents={[]} t={t} />)
    expect(screen.getByRole('heading', { name: 'Die DACH-Community' })).toBeInTheDocument()
    expect(screen.getByText('Deutschland')).toBeInTheDocument()
    expect(screen.getByText('Österreich')).toBeInTheDocument()
    expect(screen.getByText('Schweiz')).toBeInTheDocument()
  })

  it('renders the closing register CTA', () => {
    render(<GuestLanding upcomingEvents={[]} t={t} />)
    expect(screen.getByRole('heading', { name: /erstes Turnier/ })).toBeInTheDocument()
    const register = screen.getAllByRole('link', { name: 'Jetzt registrieren' })
    expect(register.length).toBeGreaterThanOrEqual(2) // hero + closing section
  })
})

describe('GuestLanding — localization (RC14 #17)', () => {
  it('renders the English dictionary when the request locale is en', () => {
    render(<GuestLanding upcomingEvents={[]} t={enMessages} />)
    expect(screen.getByRole('heading', { name: 'Everything for your X adventure' })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Register now' }).length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('heading', { name: 'The DACH community' })).toBeInTheDocument()
    expect(screen.getByText('Germany')).toBeInTheDocument()
    // The brand/identity headline is intentionally NOT translated.
    expect(screen.getByRole('heading', { level: 1, name: 'BeybladeX.de' })).toBeInTheDocument()
  })
})
