// components/home/LandingEventTeaser.tsx (RC13 issue #88, übernommen aus #23)
// The guest landing page's "Kommende Events" section (#88 resolves the old TODO(Phase 3)
// in app/page.tsx by implementing the teaser now): 2–3 of the soonest upcoming public
// events as teaser tiles, each linked to its /events/[id] detail page. Presentational by
// design — app/page.tsx fetches (public-cache TTL 60s) and passes plain props, so this
// component is unit-testable with and without data.
// #23's rules, binding: no empty/misleading placeholder — with no upcoming events the
// section renders an honest fallback with a discovery CTA to /events instead of fake tiles.
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { formatDateDay, formatTimeHM } from '@/lib/formatDateTime'
import type { DachCountry } from '@/lib/dachRegions'

const COUNTRY_LABELS: Record<DachCountry, string> = {
  DE: 'Deutschland',
  AT: 'Österreich',
  CH: 'Schweiz',
}

const TEASER_LIMIT = 3

export interface LandingTeaserEvent {
  id: string
  title: string
  startDate: Date
  city: string
  state: string
  country: DachCountry
}

export function LandingEventTeaser({ events }: { events: LandingTeaserEvent[] }) {
  const teaser = events.slice(0, TEASER_LIMIT)

  return (
    <section aria-labelledby="landing-events-heading">
      <h2 id="landing-events-heading" className="text-2xl font-semibold">
        Kommende Events
      </h2>
      {teaser.length === 0 ? (
        // #23 — honest fallback, no fake tiles: the calendar exists, it is simply empty.
        <p className="mt-3 text-current/70">
          Aktuell sind keine Events im Kalender — schau später nochmal vorbei oder{' '}
          <Link href="/events" className="text-x-cyan-text hover:underline dark:text-x-cyan">
            entdecke die Event-Übersicht →
          </Link>
        </p>
      ) : (
        <>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {teaser.map((event) => (
              <li key={event.id}>
                <Link href={`/events/${event.id}`} className="block transition-opacity hover:opacity-80">
                  <Card className="h-full">
                    <h3 className="font-semibold text-x-cyan-text dark:text-x-cyan">{event.title}</h3>
                    <p className="mt-2 text-sm text-current/70">
                      {formatDateDay(event.startDate)}, {formatTimeHM(event.startDate)} Uhr
                      <br />
                      {event.city}, {event.state} · {COUNTRY_LABELS[event.country]}
                    </p>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-4">
            <Link
              href="/events"
              className="text-sm font-medium text-x-cyan-text hover:underline dark:text-x-cyan"
            >
              Alle Events anzeigen →
            </Link>
          </p>
        </>
      )}
    </section>
  )
}
