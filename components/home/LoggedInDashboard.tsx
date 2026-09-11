// components/home/LoggedInDashboard.tsx (RC9 issue #31)
// The logged-in home view. Issue #31's decision, documented: DYNAMIC BLOCK over redirect —
// the data the review asked for (next own tournament, club activity) is available in the DB
// today, so instead of routing logged-in users past the home page to /events, the page keeps
// its welcoming role and puts live content on it:
//   1. "Dein nächstes Turnier" — the soonest upcoming event the user participates in
//      (falls back to an Events-entdecken CTA when there is none).
//   2. "Club-Aktivität" — the newest chat message across the user's ACTIVE club memberships
//      (falls back to a Clubs-entdecken CTA when there is none).
// The three static shortcut cards stay below as navigation; they are no longer the only
// content. Presentational by design — app/page.tsx fetches and passes plain props, so this
// component is unit-testable with and without data.
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { formatDateTime } from '@/lib/formatDateTime'

export interface DashboardNextEvent {
  id: string
  title: string
  startDate: Date
  city: string
}

export interface DashboardClubActivity {
  clubSlug: string
  clubName: string
  /** Display name, or "Gelöschter Nutzer" when the author's account was erased (ClubMessage survives erasure by design). */
  authorName: string
  body: string
  createdAt: Date
}

const PRIMARY_LINKS = [
  { href: '/decks', title: 'Decks', description: 'Verwalte deine Turnier-Decks.' },
  { href: '/collection', title: 'Sammlung', description: 'Erfasse deine Teile und builds.' },
  { href: '/clubs', title: 'Clubs', description: 'Finde Beyblade-Clubs in deiner Nähe.' },
] as const

const ACTIVITY_BODY_MAX = 120

export function LoggedInDashboard({
  name,
  nextEvent,
  clubActivity,
}: {
  name: string
  nextEvent: DashboardNextEvent | null
  clubActivity: DashboardClubActivity | null
}) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">Willkommen zurück, {name}</h1>

      {/* #31 — dynamic blocks; each falls back to a discovery CTA when its data is empty. */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h2 className="font-semibold text-x-cyan-text dark:text-x-cyan">Dein nächstes Turnier</h2>
          {nextEvent ? (
            <p className="mt-2 text-sm text-current/70">
              <Link href={`/events/${nextEvent.id}`} className="font-medium hover:underline">
                {nextEvent.title}
              </Link>
              <br />
              {formatDateTime(nextEvent.startDate)} · {nextEvent.city}
            </p>
          ) : (
            <p className="mt-2 text-sm text-current/60">
              Du bist aktuell bei keinem anstehenden Turnier angemeldet.{' '}
              <Link href="/events" className="text-x-cyan-text hover:underline">
                Events entdecken →
              </Link>
            </p>
          )}
        </Card>

        <Card>
          <h2 className="font-semibold text-x-cyan-text dark:text-x-cyan">Club-Aktivität</h2>
          {clubActivity ? (
            <p className="mt-2 text-sm text-current/70">
              <span className="font-medium">{clubActivity.authorName}</span> in{' '}
              <Link href={`/clubs/${clubActivity.clubSlug}`} className="font-medium hover:underline">
                {clubActivity.clubName}
              </Link>
              <br />
              {clubActivity.body.length > ACTIVITY_BODY_MAX
                ? `${clubActivity.body.slice(0, ACTIVITY_BODY_MAX)}…`
                : clubActivity.body}
            </p>
          ) : (
            <p className="mt-2 text-sm text-current/60">
              Noch keine Club-Aktivität.{' '}
              <Link href="/clubs" className="text-x-cyan-text hover:underline">
                Clubs entdecken →
              </Link>
            </p>
          )}
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {PRIMARY_LINKS.map(({ href, title, description }) => (
          <Link key={href} href={href} className="block transition-opacity hover:opacity-80">
            <Card>
              <h2 className="font-semibold text-x-cyan-text dark:text-x-cyan">{title}</h2>
              <p className="mt-1 text-sm text-current/60">{description}</p>
            </Card>
          </Link>
        ))}
      </div>
    </main>
  )
}
