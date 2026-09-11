// tests/unit/event-list-card.test.tsx (RC9 issue #32, #27 adds the tournament-badge tests)
// #32 — the event card's metadata must be visually separated: the title link contains ONLY
// the title (previously date/title/price/location ran together as "10,00 €DE, Hessen,
// Wiesbaden"), the price is its own chip, and location/country/participants are distinct
// middot-separated spans.
// #27 — the Event↔Turnier link is visible in the list: "Turnier live" once the organizer
// started the tournament, "Bracket verfügbar" when stages exist, and NO badge at all for a
// plain event (no misleading hint).
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { EventListCard, type EventListCardProps } from '@/components/tournament/EventListCard'

const BASE: EventListCardProps = {
  id: 'evt-1',
  title: 'Rhein-Main Burst Cup',
  startDate: new Date('2026-10-03T14:00:00'),
  city: 'Wiesbaden',
  state: 'Hessen',
  country: 'DE',
  entryFeeCent: 1000,
  currency: 'EUR',
  isRecurring: false,
  participantCount: 12,
  headerImageId: null,
  stageCount: 0,
  startedAt: null,
}

describe('EventListCard — metadata separation (#32)', () => {
  it('title link contains only the title — no price or location fused into it', () => {
    render(<EventListCard {...BASE} />)
    const link = screen.getByRole('link', { name: 'Rhein-Main Burst Cup' })
    expect(link).toHaveAttribute('href', '/events/evt-1')
    expect(link.textContent).toBe('Rhein-Main Burst Cup')
  })

  it('renders the price as its own chip, separate from title and location', () => {
    render(<EventListCard {...BASE} />)
    // 1000 cent → "10,00 €" via de-DE currency formatting, as a standalone element.
    expect(screen.getByText('10,00 €')).toBeInTheDocument()
    // Not fused to the country anymore: no element contains "€DE" or "€Deutschland".
    expect(screen.queryByText(/€\s*D/)).not.toBeInTheDocument()
  })

  it('renders "Eintritt frei" for a zero fee', () => {
    render(<EventListCard {...BASE} entryFeeCent={0} />)
    expect(screen.getByText('Eintritt frei')).toBeInTheDocument()
  })

  it('separates city/state, country and participants into distinct spans', () => {
    render(<EventListCard {...BASE} />)
    expect(screen.getByText('Wiesbaden, Hessen')).toBeInTheDocument()
    expect(screen.getByText('Deutschland')).toBeInTheDocument()
    expect(screen.getByText('12 Teilnehmer')).toBeInTheDocument()
    // The old fused form "DE, Hessen, Wiesbaden" must be gone.
    expect(screen.queryByText(/DE, Hessen/)).not.toBeInTheDocument()
  })
})

describe('EventListCard — tournament badge (#27)', () => {
  it('shows no badge for a plain event', () => {
    render(<EventListCard {...BASE} />)
    expect(screen.queryByText('Turnier live')).not.toBeInTheDocument()
    expect(screen.queryByText('Bracket verfügbar')).not.toBeInTheDocument()
  })

  it('shows "Bracket verfügbar" when stages exist but the tournament has not started', () => {
    render(<EventListCard {...BASE} stageCount={2} />)
    expect(screen.getByText('Bracket verfügbar')).toBeInTheDocument()
    expect(screen.queryByText('Turnier live')).not.toBeInTheDocument()
  })

  it('shows "Turnier live" once the organizer started the tournament', () => {
    render(<EventListCard {...BASE} stageCount={2} startedAt={new Date('2026-10-03T14:05:00')} />)
    expect(screen.getByText('Turnier live')).toBeInTheDocument()
    expect(screen.queryByText('Bracket verfügbar')).not.toBeInTheDocument()
  })

  it('shows "Turnier live" even when a started tournament has no stages yet', () => {
    render(<EventListCard {...BASE} startedAt={new Date()} />)
    expect(screen.getByText('Turnier live')).toBeInTheDocument()
    expect(screen.queryByText('Bracket verfügbar')).not.toBeInTheDocument()
  })
})
