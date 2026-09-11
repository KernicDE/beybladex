// tests/unit/logged-in-dashboard.test.tsx (RC9 issue #31)
// The logged-in home page must show dynamic content instead of only the static link list:
// the user's next upcoming tournament and the latest club chat message across their ACTIVE
// memberships — each with a discovery-CTA fallback when there is no data (verified here in
// both states).
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import {
  LoggedInDashboard,
  type DashboardNextEvent,
  type DashboardClubActivity,
} from '@/components/home/LoggedInDashboard'

const NEXT_EVENT: DashboardNextEvent = {
  id: 'evt-9',
  title: 'Rhein-Main Burst Cup',
  startDate: new Date('2026-10-03T14:00:00+02:00'),
  city: 'Wiesbaden',
}

const CLUB_ACTIVITY: DashboardClubActivity = {
  clubSlug: 'burst-berlin',
  clubName: 'Burst Berlin',
  authorName: 'Kai',
  body: 'Training am Donnerstag wie immer — bitte pünktlich!',
  createdAt: new Date('2026-09-10T18:30:00+02:00'),
}

describe('LoggedInDashboard — dynamic blocks (#31)', () => {
  it('greets the user by name', () => {
    render(<LoggedInDashboard name="Nico" nextEvent={null} clubActivity={null} />)
    expect(screen.getByRole('heading', { name: 'Willkommen zurück, Nico' })).toBeInTheDocument()
  })

  it('shows the next upcoming event with a link to its detail page', () => {
    render(<LoggedInDashboard name="Nico" nextEvent={NEXT_EVENT} clubActivity={null} />)
    const link = screen.getByRole('link', { name: 'Rhein-Main Burst Cup' })
    expect(link).toHaveAttribute('href', '/events/evt-9')
    // Date/place sit next to the title, not inside the link.
    expect(screen.getByText(/Wiesbaden/)).toBeInTheDocument()
  })

  it('shows the latest club activity with author and club links', () => {
    render(<LoggedInDashboard name="Nico" nextEvent={null} clubActivity={CLUB_ACTIVITY} />)
    expect(screen.getByText('Kai')).toBeInTheDocument()
    const clubLink = screen.getByRole('link', { name: 'Burst Berlin' })
    expect(clubLink).toHaveAttribute('href', '/clubs/burst-berlin')
    expect(screen.getByText(/Training am Donnerstag/)).toBeInTheDocument()
  })

  it('truncates very long chat bodies', () => {
    render(
      <LoggedInDashboard
        name="Nico"
        nextEvent={null}
        clubActivity={{ ...CLUB_ACTIVITY, body: 'x'.repeat(300) }}
      />,
    )
    expect(screen.getByText('x'.repeat(120), { exact: false })).toBeInTheDocument()
    expect(screen.getByText(/x{120}…/)).toBeInTheDocument()
  })
})

describe('LoggedInDashboard — empty-state fallbacks (#31)', () => {
  it('points to /events when the user has no upcoming tournament', () => {
    render(<LoggedInDashboard name="Nico" nextEvent={null} clubActivity={null} />)
    expect(screen.getByText(/keinem anstehenden Turnier angemeldet/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Events entdecken/ })).toHaveAttribute('href', '/events')
  })

  it('points to /clubs when there is no club activity', () => {
    render(<LoggedInDashboard name="Nico" nextEvent={null} clubActivity={null} />)
    expect(screen.getByText(/Noch keine Club-Aktivität/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Clubs entdecken/ })).toHaveAttribute('href', '/clubs')
  })

  it('keeps the static shortcut cards as navigation below the dynamic blocks', () => {
    render(<LoggedInDashboard name="Nico" nextEvent={NEXT_EVENT} clubActivity={CLUB_ACTIVITY} />)
    expect(screen.getByRole('link', { name: /Decks/ })).toHaveAttribute('href', '/decks')
    expect(screen.getByRole('link', { name: /Sammlung/ })).toHaveAttribute('href', '/collection')
    expect(screen.getByRole('link', { name: /Clubs/ })).toHaveAttribute('href', '/clubs')
  })
})
