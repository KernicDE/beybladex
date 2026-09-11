// tests/unit/landing-event-teaser.test.tsx (RC13 issue #88, übernommen aus #23)
// The guest landing's upcoming-events teaser: with data it shows the events as tiles linked
// to their detail pages plus a link to the full /events list; without data it renders an
// honest fallback (#23: no empty/misleading placeholder — a discovery CTA instead).
// Dates use explicit +02:00 offsets so the rendered Berlin time is timezone-independent.
import { render, screen, within } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import {
  LandingEventTeaser,
  type LandingTeaserEvent,
} from '@/components/home/LandingEventTeaser'

const EVENTS: LandingTeaserEvent[] = [
  {
    id: 'evt-1',
    title: 'Rhein-Main Burst Cup',
    startDate: new Date('2026-10-03T14:00:00+02:00'),
    city: 'Wiesbaden',
    state: 'Hessen',
    country: 'DE',
  },
  {
    id: 'evt-2',
    title: 'Alpen-Clash Wien',
    startDate: new Date('2026-10-10T10:00:00+02:00'),
    city: 'Wien',
    state: 'Wien',
    country: 'AT',
  },
  {
    id: 'evt-3',
    title: 'Zürcher X-Duell',
    startDate: new Date('2026-10-17T17:30:00+02:00'),
    city: 'Zürich',
    state: 'Zürich',
    country: 'CH',
  },
]

describe('LandingEventTeaser — with events (#88)', () => {
  it('renders each event as a tile linked to its detail page', () => {
    render(<LandingEventTeaser events={EVENTS} />)
    for (const event of EVENTS) {
      const link = screen.getByRole('link', { name: new RegExp(event.title) })
      expect(link).toHaveAttribute('href', `/events/${event.id}`)
    }
  })

  it('shows date and place per tile', () => {
    render(<LandingEventTeaser events={EVENTS} />)
    const list = screen.getByRole('list')
    const firstTile = within(list).getAllByRole('listitem')[0]
    expect(within(firstTile).getByText(/Wiesbaden, Hessen · Deutschland/)).toBeInTheDocument()
    expect(within(firstTile).getByText(/14:00 Uhr/)).toBeInTheDocument()
  })

  it('links to the full /events list below the tiles', () => {
    render(<LandingEventTeaser events={EVENTS} />)
    expect(screen.getByRole('link', { name: /Alle Events anzeigen/ })).toHaveAttribute(
      'href',
      '/events',
    )
  })

  it('caps the teaser at three tiles', () => {
    render(<LandingEventTeaser events={[...EVENTS, ...EVENTS]} />)
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
  })
})

describe('LandingEventTeaser — without events (#23/#88)', () => {
  it('renders an honest fallback with a discovery CTA instead of placeholder tiles', () => {
    render(<LandingEventTeaser events={[]} />)
    expect(screen.getByText(/keine Events im Kalender/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Event-Übersicht/ })).toHaveAttribute('href', '/events')
    // No fake tiles.
    expect(screen.queryByRole('list')).not.toBeInTheDocument()
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument()
  })
})
