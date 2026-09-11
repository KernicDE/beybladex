// tests/unit/event-list-card.test.tsx (RC9 issue #32, #27 adds the tournament-badge tests,
// RC11 #80 reorders line 1 and moves the price to line 2)
// #32 — the event card's metadata must be visually separated: the title link contains ONLY
// the title (previously date/title/price/location ran together as "10,00 €DE, Hessen,
// Wiesbaden"), and location/country/participants/price are distinct middot-separated spans.
// #80 — line 1 is title-first: "Titel – Freitag, 11.09.2026, 10:30 Uhr" (ausgeschriebener
// Wochentag, TT.MM.JJJJ); the entry fee closes line 2 after the participant count.
// #27 — the Event↔Turnier link is visible in the list: "Turnier live" once the organizer
// started the tournament, "Bracket verfügbar" when stages exist, and NO badge at all for a
// plain event (no misleading hint).
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { EventListCard, type EventListCardProps } from '@/components/tournament/EventListCard'

const BASE: EventListCardProps = {
  id: 'evt-1',
  title: 'Rhein-Main Burst Cup',
  // 2026-10-03 is a Saturday; 14:00 UTC renders as "Samstag, 03.10.2026, 16:00 Uhr" in
  // Europe/Berlin (CEST) — the explicit Z keeps the expectation host-timezone independent.
  startDate: new Date('2026-10-03T14:00:00Z'),
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

describe('EventListCard — line order and metadata separation (#80, #32)', () => {
  it('title link contains only the title — no price or location fused into it', () => {
    render(<EventListCard {...BASE} />)
    const link = screen.getByRole('link', { name: 'Rhein-Main Burst Cup' })
    expect(link).toHaveAttribute('href', '/events/evt-1')
    expect(link.textContent).toBe('Rhein-Main Burst Cup')
  })

  it('line 1 is title-first, followed by the weekday (long) and TT.MM.JJJJ plus time', () => {
    render(<EventListCard {...BASE} />)
    const line1 = screen.getByText(/Samstag, 03\.10\.2026, 16:00 Uhr/)
    expect(line1).toBeInTheDocument()
    // The old long form with abbreviated weekday + spelled-out month is gone.
    expect(screen.queryByText(/Sa\.,/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Oktober/)).not.toBeInTheDocument()
  })

  it('renders the price at the end of line 2, after the participant count', () => {
    render(<EventListCard {...BASE} />)
    // 1000 cent → "10,00 €" via de-DE currency formatting, as a standalone element.
    expect(screen.getByText('10,00 €')).toBeInTheDocument()
    const line2 = screen.getByText('10,00 €').closest('p')!
    expect(line2.textContent).toContain('Wiesbaden, Hessen')
    expect(line2.textContent).toContain('12 Teilnehmer')
    // The fee closes the line — it comes AFTER the participant count. (Intl currency output
    // uses a narrow no-break space — compare position on the normalized string.)
    const normalized = line2.textContent!.replace(/[\u00A0\u202F]/g, ' ')
    expect(normalized.indexOf('10,00 €')).toBeGreaterThan(normalized.indexOf('12 Teilnehmer'))
    // Not fused to the country anymore: no element contains "€DE" or "€Deutschland".
    expect(screen.queryByText(/€\s*D/)).not.toBeInTheDocument()
  })

  it('renders "Eintritt frei" for a zero fee at the end of line 2', () => {
    render(<EventListCard {...BASE} entryFeeCent={0} />)
    expect(screen.getByText('Eintritt frei')).toBeInTheDocument()
    const line2 = screen.getByText('Eintritt frei').closest('p')!
    expect(line2.textContent).toContain('12 Teilnehmer')
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
