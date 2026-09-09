// app/events/page.tsx
// Public DACH event calendar: Leaflet map + chronological list + filters (country, state, text
// search over title/city via ?q=). Radius-from-postal-code search needs the geo track's
// lib/geocodePostalCode — until it lands, the API's lat/lng/radiusKm params are the only radius
// entry point and this page links none of them TODO(geo track): postal-code radius UI.
// EmptyState renders a "Turnier erstellen" CTA for ORGANIZER/ADMIN sessions — club-admin-only
// sessions get the CTA once Phase 4's Club membership UI lands (see TODO below).
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { MapView } from '@/components/map/MapView'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { SearchInput } from '@/components/ui/SearchInput'
import { Select } from '@/components/ui/Select'

export const revalidate = 60 // public, frequently-added content [REVIEW-FIX: performance P16]

const PAGE_SIZE = 24
const COUNTRIES = [
  { value: '', label: 'Alle Länder' },
  { value: 'DE', label: 'Deutschland' },
  { value: 'AT', label: 'Österreich' },
  { value: 'CH', label: 'Schweiz' },
] as const

// Center of the DACH region when no result pins the map.
const DEFAULT_CENTER = { lat: 48.5, lng: 10 }

function formatDate(date: Date): string {
  return date.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
}

function formatFee(cent: number, currency: string): string {
  if (cent === 0) return 'Eintritt frei'
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(cent / 100)
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ country?: string; state?: string; q?: string; cursor?: string }>
}) {
  const { country, state, q, cursor } = await searchParams
  const session = await auth()
  const query = (q ?? '').trim()

  const caller = session?.user?.id
    ? await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
    : null
  // TODO(Phase 4): also offer the CTA to users who administer at least one club (ClubMember.isAdmin)
  // even without the global ORGANIZER/ADMIN role — needs the Phase 4 club membership surfaces.
  const canCreate = caller?.role === 'ORGANIZER' || caller?.role === 'ADMIN'

  const rows = await prisma.tournament.findMany({
    where: {
      ...(country ? { country: country as 'DE' | 'AT' | 'CH' } : {}),
      ...(state ? { state } : {}),
      ...(query
        ? { OR: [{ title: { contains: query, mode: 'insensitive' } }, { city: { contains: query, mode: 'insensitive' } }] }
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

      {/* Filter bar: plain GET form so every filter combination is a shareable URL. */}
      <form method="GET" className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="sm:w-48">
          <label htmlFor="filter-country" className="mb-1 block text-sm">
            Land
          </label>
          <Select id="filter-country" name="country" defaultValue={country ?? ''}>
            {COUNTRIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="sm:w-48">
          <label htmlFor="filter-state" className="mb-1 block text-sm">
            Bundesland / Kanton
          </label>
          <Input id="filter-state" name="state" defaultValue={state ?? ''} placeholder="z. B. Bayern" />
        </div>
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
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/events/${t.id}`} className="font-semibold hover:underline">
                    {t.title}
                  </Link>
                  {t.isRecurring && <Badge tone="cyan">Wiederkehrend</Badge>}
                </div>
                <p className="mt-1 text-sm text-current/60">
                  {formatDate(t.startDate)} · {t.city}, {t.state} ({t.country}) ·{' '}
                  {formatFee(t.entryFeeCent, t.currency)} · {t._count.participants} Teilnehmer
                </p>
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
