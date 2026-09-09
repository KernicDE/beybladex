// app/search/page.tsx
// Typed-sections search page (Task 13 shell). The shared page and the SearchInput
// entry point live here; the RESULT BACKENDS are phased — Phase 3 wired the Events
// section, Phase 4 (this file's Nutzer section) the user search, Phase 5 Part A (this
// file's Teile section) the parts-catalog search (server-side prefix + category filter,
// a hard prerequisite for the deck builder's part-picker). The Clubs section is wired
// by the parallel clubs/admin track — its EmptyState below is that track's integration
// point; do not remove it here.
import Link from 'next/link'
import Image from 'next/image'
import { auth } from '@/lib/auth'
import { searchUsers } from '@/lib/userSearch'
import { searchParts } from '@/lib/buildSearch'
import { getPartStats } from '@/lib/metaCache'
import { EmptyState } from '@/components/ui/EmptyState'
import { TypeBadge } from '@/components/beyblade/TypeBadge'
import { WinRateBadge } from '@/components/beyblade/WinRateBadge'
import { PartRequestCTA } from '@/components/beyblade/PartRequestCTA'

const SECTIONS = [
  { id: 'events', title: 'Events' },
  { id: 'clubs', title: 'Clubs' },
] as const

export const dynamic = 'force-dynamic'

export default async function SearchPage({ searchParams }: PageProps<'/search'>) {
  const { q, cursor } = await searchParams
  const query = typeof q === 'string' ? q : ''

  const session = await auth()
  const viewerId = session?.user?.id ?? null
  const userResults = query ? await searchUsers({ viewerId, q: query, cursor: typeof cursor === 'string' ? cursor : null }) : null
  const partResults = query ? await searchParts({ q: query }) : null
  // Auto-Meta part win-rate badges (Phase 5 Part D): one batch mget for the result list.
  const partStats = partResults ? await getPartStats(partResults.parts.map((p) => p.id)) : null

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">Suche</h1>
      {query && (
        <p className="text-current/70">
          Ergebnisse für „{query}“
        </p>
      )}
      <section aria-labelledby="search-users" className="space-y-3">
        <h2 id="search-users" className="text-lg font-semibold">
          Nutzer
        </h2>
        {!query ? (
          <EmptyState
            title="Gib einen Nutzernamen ein"
            description="Die Nutzersuche findet Profile anhand des Benutzernamens."
          />
        ) : userResults!.users.length === 0 ? (
          <EmptyState
            title="Keine Nutzer gefunden"
            description="Entweder existiert kein passender Benutzername, oder die gefundenen Profile sind auf privat gestellt."
          />
        ) : (
          <>
            <ul className="divide-y rounded-xl border">
              {userResults!.users.map((user) => (
                <li key={user.id}>
                  <Link href={`/profile/${user.username}`} className="block px-4 py-3 hover:bg-current/5">
                    {user.displayName ?? user.username}
                    <span className="ml-2 text-sm text-current/60">@{user.username}</span>
                    {user.isFriend && <span className="ml-2 text-sm text-x-cyan-text">Freund</span>}
                  </Link>
                </li>
              ))}
            </ul>
            {userResults!.nextCursor && (
              <Link
                href={`/search?q=${encodeURIComponent(query)}&cursor=${userResults!.nextCursor}`}
                className="inline-block underline underline-offset-2"
              >
                Weitere Nutzer laden
              </Link>
            )}
          </>
        )}
        {!viewerId && query && (
          <p className="text-sm text-current/60">
            Als Gast siehst du nur öffentliche Profile. Melde dich an, um Freunde zu finden.
          </p>
        )}
      </section>
      <section aria-labelledby="search-parts" className="space-y-3">
        <h2 id="search-parts" className="text-lg font-semibold">
          Teile
        </h2>
        {!query ? (
          <EmptyState
            title="Gib einen Teilnamen ein"
            description="Die Teilesuche durchsucht den Katalog nach Blades, Ratchets und Bits."
          />
        ) : partResults!.parts.length === 0 ? (
          <EmptyState
            title="Keine Teile gefunden"
            description="Dieses Teil ist noch nicht im Katalog. Du kannst es unten anfragen."
          />
        ) : (
          <ul className="divide-y rounded-xl border">
            {partResults!.parts.map((part) => (
              <li key={part.id}>
                <Link href={`/builds?q=${encodeURIComponent(part.name)}`} className="flex items-center gap-3 px-4 py-3 hover:bg-current/5">
                  {part.imageUrl ? (
                    <Image src={part.imageUrl} alt="" width={40} height={40} sizes="40px" className="h-10 w-10 rounded object-contain" />
                  ) : (
                    <span aria-hidden="true" className="h-10 w-10 rounded bg-x-cyan/10" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{part.name}</span>
                    <span className="block text-sm text-current/60">{part.category} · {part.manufacturer === 'TT' ? 'Takara Tomy' : 'Hasbro'}</span>
                  </span>
                  {part.beyType && <TypeBadge type={part.beyType} />}
                  <WinRateBadge stats={partStats?.get(part.id) ?? null} />
                </Link>
              </li>
            ))}
          </ul>
        )}
        {query && partResults!.parts.length === 0 && (
          <PartRequestCTA defaultName={query} loggedIn={viewerId !== null} />
        )}
      </section>
      {SECTIONS.map(({ id, title }) => (
        <section key={id} aria-labelledby={`search-${id}`} className="space-y-3">
          <h2 id={`search-${id}`} className="text-lg font-semibold">
            {title}
          </h2>
          <EmptyState
            title="Suche noch nicht verfügbar"
            description="Dieser Bereich wird in einer späteren Ausbauphase aktiviert."
          />
        </section>
      ))}
    </main>
  )
}
