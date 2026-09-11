// app/events/page.tsx
// Public DACH event calendar: Leaflet map + chronological list + filters (country, state, text
// search over title/city via ?q=, date range, and — since RC9 #33 — a postal-code radius:
// ?plz=65189&radiusKm=50 geocodes the PLZ via lib/geo.ts's Nominatim-backed geocodePostalCode
// (against the selected country, DE when none is selected), prefilters SQL by a bounding box
// and applies the exact haversine pass to the result rows. An unresolvable PLZ degrades to a
// notice + unfiltered list, never to an error.
// EmptyState renders a "Turnier erstellen" CTA for ORGANIZER/ADMIN sessions AND for users who
// administer at least one club (Phase 4's Club membership path — the same rule the API enforces).
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { withPublicCache } from '@/lib/publicCache'
import { geocodePostalCode, isWithinRadiusKm, radiusBoundingBox, type DachCountry } from '@/lib/geo'
import { MapView } from '@/components/map/MapView'
import { EmptyState } from '@/components/ui/EmptyState'
import { SearchInput } from '@/components/ui/SearchInput'
import { EventsFilterBar } from '@/components/tournament/EventsFilterBar'
import { EventListCard } from '@/components/tournament/EventListCard'

// [RC5 #43] No `revalidate` export: this page reads searchParams (filters) AND auth()
// (session-gated CTA), which force per-request rendering in Next 16's non-cacheComponents
// model — a revalidate export would be dead config. The public list query is cached in Redis
// for 60s instead (lib/publicCache.ts), which is the caching the revalidate line promised.
const PUBLIC_LIST_TTL = 60

const PAGE_SIZE = 24
// YYYY-MM-DD only — anything else is a malformed date input and must not 500 the page
// (Phase 10 item 8's explicit requirement).
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
// Radius sanity bounds: the UI offers 25/50/100 km, hand-crafted URLs may pick anything in (0, 500].
const MAX_RADIUS_KM = 500
const DEFAULT_RADIUS_KM = 50

// Center of the DACH region when no result pins the map.
const DEFAULT_CENTER = { lat: 48.5, lng: 10 }

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ country?: string; state?: string; q?: string; cursor?: string; from?: string; to?: string; plz?: string; radiusKm?: string }>
}) {
  const { country, state, q, cursor, from, to, plz, radiusKm } = await searchParams
  // Malformed/unparseable input is ignored (no bound on that side) rather than erroring the
  // whole list — a mistyped date must not 500 the page.
  const fromDate = from && DATE_RE.test(from) ? new Date(`${from}T00:00:00`) : null
  const toDate = to && DATE_RE.test(to) ? new Date(`${to}T23:59:59`) : null
  const session = await auth()
  const query = (q ?? '').trim()
  const plzQuery = (plz ?? '').trim()

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

  // RC9 #33 — postal-code radius. Geocode against the country filter when it is one of the
  // DACH codes, else DE (the dominant share of the calendar and the geocoder's safest guess
  // for a bare 5-digit PLZ). An unresolvable PLZ (invalid format, Nominatim miss, rate-limit
  // lock) degrades to a notice + unfiltered list — geo features never error the page.
  const radiusNum = radiusKm !== undefined && radiusKm !== '' ? Number(radiusKm) : null
  const validRadius = radiusNum !== null && Number.isFinite(radiusNum) && radiusNum > 0 && radiusNum <= MAX_RADIUS_KM
  let radiusCenter: { lat: number; lng: number; radiusKm: number } | null = null
  let plzNotice: string | null = null
  if (plzQuery) {
    const geocodeCountry: DachCountry = country === 'AT' || country === 'CH' || country === 'DE' ? country : 'DE'
    const point = await geocodePostalCode(geocodeCountry, plzQuery)
    if (point) {
      radiusCenter = { ...point, radiusKm: validRadius ? radiusNum! : DEFAULT_RADIUS_KM }
    } else {
      plzNotice = `Die PLZ „${plzQuery}“ konnte nicht gefunden werden — die Liste ist ungefiltert.`
    }
  }

  const rows = await withPublicCache(
    `public:v1:events:list:${country ?? ''}|${state ?? ''}|${query}|${cursor ?? ''}|${from ?? ''}|${to ?? ''}|${plzQuery}|${radiusCenter?.radiusKm ?? ''}`,
    PUBLIC_LIST_TTL,
    () =>
      prisma.tournament.findMany({
        where: {
          ...(country ? { country: country as 'DE' | 'AT' | 'CH' } : {}),
          ...(state ? { state } : {}),
          ...(query
            ? { OR: [{ title: { contains: query, mode: 'insensitive' } }, { city: { contains: query, mode: 'insensitive' } }] }
            : {}),
          ...(fromDate || toDate
            ? { startDate: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } }
            : {}),
          ...(radiusCenter
            ? (() => {
                // Bounding-box prefilter keeps the exact haversine pass below cheap.
                const box = radiusBoundingBox(radiusCenter, radiusCenter.radiusKm)
                return {
                  latitude: { gte: box.latMin, lte: box.latMax },
                  longitude: { gte: box.lngMin, lte: box.lngMax },
                }
              })()
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
          // #27 — the list card's Turnier/Bracket badges read these two.
          startedAt: true,
          _count: { select: { participants: true, stages: true } },
        },
      }),
  )
  // Exact pass over the bounding-box prefilter's survivors (the box's corners overcover).
  // Runs outside the cache so cached rows stay usable for every radius. May yield short pages
  // at boundaries — acceptable at DACH scale, same tradeoff as GET /api/tournaments.
  const filtered = radiusCenter
    ? rows.filter((t) => isWithinRadiusKm(radiusCenter, radiusCenter.radiusKm, { lat: t.latitude, lng: t.longitude }))
    : rows
  const hasMore = filtered.length > PAGE_SIZE
  const page = hasMore ? filtered.slice(0, PAGE_SIZE) : filtered
  const nextCursor = hasMore ? page[page.length - 1].id : null

  const filterParams = new URLSearchParams()
  if (country) filterParams.set('country', country)
  if (state) filterParams.set('state', state)
  if (query) filterParams.set('q', query)
  if (from) filterParams.set('from', from)
  if (to) filterParams.set('to', to)
  if (plzQuery) filterParams.set('plz', plzQuery)
  if (radiusCenter) filterParams.set('radiusKm', String(radiusCenter.radiusKm))
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
        center={radiusCenter ? { lat: radiusCenter.lat, lng: radiusCenter.lng } : page[0] ? { lat: page[0].latitude, lng: page[0].longitude } : DEFAULT_CENTER}
        markers={page.map((t) => ({
          id: t.id,
          lat: t.latitude,
          lng: t.longitude,
          label: t.title,
          href: `/events/${t.id}`,
        }))}
      />

      {/* Filter bar: plain GET form so every filter combination is a shareable URL. Country/
          state/date-range/PLZ-radius are the interactive client piece (EventsFilterBar); the
          query text field and submit stay here. */}
      <form method="GET" className="flex flex-col flex-wrap gap-3 sm:flex-row sm:items-end">
        <EventsFilterBar
          initialCountry={country ?? ''}
          initialState={state ?? ''}
          initialFrom={from ?? ''}
          initialTo={to ?? ''}
          initialPlz={plzQuery}
          initialRadiusKm={radiusCenter ? String(radiusCenter.radiusKm) : ''}
        />
        <button
          type="submit"
          className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium transition-colors hover:bg-current/5"
        >
          Filtern
        </button>
        <SearchInput action="/events" className="sm:ml-auto sm:w-64" />
      </form>

      {plzNotice && (
        <p role="status" className="rounded-md border border-current/20 px-3 py-2 text-sm text-current/70">
          {plzNotice}
        </p>
      )}

      {page.length === 0 ? (
        <EmptyState
          title="Keine Turniere gefunden"
          description={
            radiusCenter
              ? 'Im gewählten Umkreis gibt es aktuell keine Turniere. Vergrößere den Radius oder ändere die PLZ.'
              : query || country || state
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
              <EventListCard
                id={t.id}
                title={t.title}
                startDate={t.startDate}
                city={t.city}
                state={t.state}
                country={t.country}
                entryFeeCent={t.entryFeeCent}
                currency={t.currency}
                isRecurring={t.isRecurring}
                participantCount={t._count.participants}
                headerImageId={t.headerImageId}
                stageCount={t._count.stages}
                startedAt={t.startedAt}
              />
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
