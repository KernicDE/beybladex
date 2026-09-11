// components/home/LandingEventTeaser.tsx (RC13 issue #88, übernommen aus #23)
// The guest landing page's "Kommende Events" section (#88 resolves the old TODO(Phase 3)
// in app/page.tsx by implementing the teaser now): 2–3 of the soonest upcoming public
// events as teaser tiles, each linked to its /events/[id] detail page. Presentational by
// design — app/page.tsx fetches (public-cache TTL 60s) and passes plain props, so this
// component is unit-testable with and without data.
// #23's rules, binding: no empty/misleading placeholder — with no upcoming events the
// section renders an honest fallback with a discovery CTA to /events instead of fake tiles.
// RC14 #17 — copy resolves from the request dictionary passed in by GuestLanding.
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { formatDateDay, formatTimeHM } from '@/lib/formatDateTime'
import type { DachCountry } from '@/lib/dachRegions'
import type { Messages } from '@/lib/i18n/server'

const TEASER_LIMIT = 3

export interface LandingTeaserEvent {
  id: string
  title: string
  startDate: Date
  city: string
  state: string
  country: DachCountry
}

export function LandingEventTeaser({ events, t }: { events: LandingTeaserEvent[]; t: Messages }) {
  const teaser = events.slice(0, TEASER_LIMIT)
  // German appends the "Uhr" suffix to clock times; English (12h format from formatTimeHM)
  // uses none — the empty string is intentional, so guard the join instead of trimming.
  const clockSuffix = t.teaser.oClock ? ` ${t.teaser.oClock}` : ''

  return (
    <section aria-labelledby="landing-events-heading">
      <h2 id="landing-events-heading" className="text-2xl font-semibold">
        {t.teaser.heading}
      </h2>
      {teaser.length === 0 ? (
        // #23 — honest fallback, no fake tiles: the calendar exists, it is simply empty.
        <p className="mt-3 text-current/70">
          {t.teaser.empty}{' '}
          <Link href="/events" className="text-x-cyan-text hover:underline dark:text-x-cyan">
            {t.teaser.emptyLink}
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
                      {formatDateDay(event.startDate)}, {formatTimeHM(event.startDate)}{clockSuffix}
                      <br />
                      {event.city}, {event.state} · {t.regions[event.country]}
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
              {t.teaser.showAll}
            </Link>
          </p>
        </>
      )}
    </section>
  )
}
