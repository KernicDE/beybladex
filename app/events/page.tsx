// app/events/page.tsx
// Public DACH event calendar: Leaflet map + chronological list + filters (country, state, text
// search over title/city via ?q=). Radius-from-postal-code search needs the geo track's
// lib/geocodePostalCode — until it lands, the API's lat/lng/radiusKm params are the only radius
// entry point and this page links none of them TODO(geo track): postal-code radius UI.
// EmptyState renders a "Turnier erstellen" CTA for ORGANIZER/ADMIN sessions AND for users who
// administer at least one club (Phase 4's Club membership path — the same rule the API enforces).
import Link from 'next/link'
import Image from 'next/image'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { MapView } from '@/components/map/MapView'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { SearchInput } from '@/components/ui/SearchInput'
import { EventsFilterBar } from '@/components/tournament/EventsFilterBar'

export const revalidate = 60 // public, frequently-added content [REVIEW-FIX: performance P16]

const PAGE_SIZE = 24
// YYYY-MM-DD only — anything else is a malformed date input and must not 500 the page
// (Phase 10 item 8's explicit requirement).
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Center of the DACH region when no result pins the map.
const DEFAULT_CENTER = { lat: 48.5, lng: 10 }

function formatDate(date: Date): string {
  return date.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}

function formatFee(cent: number, currency: string): string {
  if (cent === 0) return 'Eintritt frei'
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(cent / 100)
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ country?: string; state?: string; q?: string; cursor?: string; from?: string; to?: string }>
}) {
  const { country, state, q, cursor, from, to } = await searchParams
  // Malformed/unparseable input is ignored (no bound on that side) rather than erroring the
  // whole list — a mistyped date must not 500 the page.
  const fromDate = from && DATE_RE.test(from) ? new Date(`${from}T00:00:00`) : null
  const toDate = to && DATE_RE.test(to) ? new Date(`${to}T23:59:59`) : null
  const session = await auth()
  const query = (q ?? '').trim()

  const caller = session?.user?.id
    ? await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
    : null
  // Same rule as POST /api/tournaments: global organizer/admin role OR administration of at
  // least one club (owner or isAdmin member). Phase 13: only ACTIVE memberships count —
  // a pending application/invite confers no organizer rights.
  const adminClubCount = session?.user?.id
    ? await prisma.clubMember.count({ where: { userId: session.user.id, isAdmin: true, status: 'ACTIVE' } })
    : 0
  const canCreate = caller?.role === 'ORGANIZER' || caller?.role === 'ADMIN' || adminClubCount > 0

  const rows = await prisma.tournament.findMany({
    where: {
      ...(country ? { country: country as 'DE' | 'AT' | 'CH' } : {}),
      ...(state ? { state } : {}),
      ...(query
        ? { OR: [{ title: { contains: query, mode: 'insensitive' } }, { city: { contains: query, mode: 'insensitive' } }] }
        : {}),
      ...(fromDate || toDate
        ? { startDate: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } }
        : {}),
    },
    orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true,
      title: true,
      startDate: true,
      city: true,
      state: true,
      country: true,
      latitude: true,
      longitude: true,
      entryFeeCent: true,
      currency: true,
      isRecurring: true,
      headerImageId: true,
      _count: { select: { participants: true } },
    },
  })
  const hasMore = rows.length > PAGE_SIZE
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows
  const nextCursor = hasMore ? page[page.length - 1].id : null

  const filterParams = new URLSearchParams()
  if (country) filterParams.set('country', country)
  if (state) filterParams.set('state', state)
  if (query) filterParams.set('q', query)
  if (from) filterParams.set('from', from)
  if (to) filterParams.set('to', to)
  const filterQuery = filterParams.toString()

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Turniere &amp; Events</h1>
        {canCreate && (
          <Link
            href="/events/new"
            className="rounded-md bg-x-cyan px-4 py-2 text-sm font-medium text-base-dark transition-colors hover:bg-x-cyan/85"
          >
            Turnier erstellen
          </Link>
        )}
      </div>

      <MapView
        className="z-0 h-72 w-full rounded-xl border border-x-cyan/20 sm:h-96"
        center={page[0] ? { lat: page[0].latitude, lng: page[0].longitude } : DEFAULT_CENTER}
        markers={page.map((t) => ({
          id: t.id,
          lat: t.latitude,
          lng: t.longitude,
          label: t.title,
          href: `/events/${t.id}`,
        }))}
      />

      {/* Filter bar: plain GET form so every filter combination is a shareable URL. Country/
          state/date-range are the interactive client piece (EventsFilterBar); the query text
          field and submit stay here. */}
      <form method="GET" className="flex flex-col flex-wrap gap-3 sm:flex-row sm:items-end">
        <EventsFilterBar
          initialCountry={country ?? ''}
          initialState={state ?? ''}
          initialFrom={from ?? ''}
          initialTo={to ?? ''}
        />
        <button
          type="submit"
          className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium transition-colors hover:bg-current/5"
        >
          Filtern
        </button>
        <SearchInput action="/events" className="sm:ml-auto sm:w-64" />
      </form>

      {page.length === 0 ? (
        <EmptyState
          title="Keine Turniere gefunden"
          description={
            query || country || state
              ? 'Für diese Filter gibt es aktuell keine Turniere. Passe die Suche an.'
              : 'Sobald ein Turnier erstellt wird, erscheint es hier und auf der Karte.'
          }
          action={
            canCreate ? (
              <Link
                href="/events/new"
                className="rounded-md bg-x-cyan px-4 py-2 text-sm font-medium text-base-dark transition-colors hover:bg-x-cyan/85"
              >
                Turnier erstellen
              </Link>
            ) : undefined
          }
        />
      ) : (
        <ul className="space-y-3">
          {page.map((t) => (
            <li key={t.id}>
              <Card className="p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {/* Phase 10 item 7 — two lines, per the user's exact spec: line 1 date/time/
                        title/price, line 2 location/participants. */}
                    <p className="flex flex-wrap items-center gap-2">
                      <Link href={`/events/${t.id}`} className="font-semibold hover:underline">
                        {formatDate(t.startDate)} {formatTime(t.startDate)} – {t.title}, {formatFee(t.entryFeeCent, t.currency)}
                      </Link>
                      {t.isRecurring && <Badge tone="cyan">Wiederkehrend</Badge>}
                    </p>
                    <p className="mt-1 text-sm text-current/60">
                      {t.country}, {t.state}, {t.city} · {t._count.participants} Teilnehmer
                    </p>
                  </div>
                  {/* Phase 11 item 5 cross-reference: right-aligned thumbnail once a header
                      image is set; a card with none keeps the text-only layout unchanged. */}
                  {t.headerImageId && (
                    <div className="relative h-16 w-24 shrink-0 overflow-hidden rounded-md">
                      <Image src={`/api/media/${t.headerImageId}`} alt="" fill sizes="96px" className="object-cover" />
                    </div>
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {nextCursor && (
        <div className="flex justify-center">
          <Link
            href={`/events?${filterQuery ? `${filterQuery}&` : ''}cursor=${nextCursor}`}
            className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium transition-colors hover:bg-current/5"
          >
            Weitere laden
          </Link>
        </div>
      )}
    </main>
  )
}
