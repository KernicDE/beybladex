// app/builds/page.tsx
// RC16 (#104): /builds ist die persönliche Build-Fläche — nur noch die eigenen (nicht-
// offiziellen) Kombinationen der eingeloggten Person (Login-Gate wie /collection, da eigene
// Builds privat sind; offizielle Sets leben künftig im Katalog-Tab der Sammlung, #102).
// "Nur eigene" nutzt denselben onlyMineUserId-Filter wie GET /api/builds?onlyMine=1 (Builds
// tragen keinen Owner-FK — Verfügbarkeit = alle Teile in der eigenen Sammlung) plus
// personalOnly (isOfficialSet: false). Die freie Teile-Kombination (BuildComboForm) ist nur
// hier möglich, hinter ?neu=1 (gleiche Konvention wie /collection?neu=1).
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { searchBuilds, BUILD_PAGE_SIZE } from '@/lib/buildSearch'
import { getBuildStats } from '@/lib/metaCache'
import { getDictionary } from '@/lib/i18n/server'
import { BuildCard } from '@/components/beyblade/BuildCard'
import { BuildComboPanel } from '@/components/beyblade/BuildComboPanel'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { GuestGate } from '@/components/auth/GuestGate'

export const dynamic = 'force-dynamic'

export default async function BuildsPage({ searchParams }: PageProps<'/builds'>) {
  const { q, cursor, neu } = await searchParams
  // RC14-Nachzügler #130 — page chrome comes from the request dictionary.
  const t = await getDictionary()
  const session = await auth()
  if (!session?.user?.id) {
    return (
      <GuestGate
        title={t.builds.gateTitle}
        description={t.builds.gateDescription}
        callbackUrl="/builds"
        labels={t.guestGate}
      />
    )
  }

  const query = typeof q === 'string' ? q.trim() : ''
  const { builds, nextCursor } = await searchBuilds({
    q: query,
    cursor: typeof cursor === 'string' ? cursor : null,
    onlyMineUserId: session.user.id,
    personalOnly: true,
  })
  // Auto-Meta badges (Phase 5 Part D): ONE batch mget for the whole page, never per-card
  // round trips. Whole-cache-empty falls back to a direct DB computation inside getBuildStats.
  const winRates = await getBuildStats(builds.map((b) => b.id))

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t.builds.heading}</h1>
        {builds.length > 0 && (
          <Link href="/builds?neu=1" className="rounded-md bg-x-cyan px-4 py-2 text-sm font-medium text-base-dark transition-colors hover:bg-x-cyan/85">
            {t.builds.newBuild}
          </Link>
        )}
      </div>
      <p className="text-current/70">
        {t.builds.intro}
      </p>

      {neu === '1' && <BuildComboPanel />}

      <form role="search" action="/builds" className="flex items-center gap-2">
        <label htmlFor="builds-q" className="sr-only">{t.builds.searchLabel}</label>
        <Input id="builds-q" name="q" type="search" defaultValue={query} placeholder={t.builds.searchPlaceholder} />
        <button type="submit" className="rounded-md bg-x-cyan px-4 py-2 text-sm font-medium text-base-dark transition-colors hover:bg-x-cyan/85">
          {t.builds.search}
        </button>
      </form>

      {builds.length === 0 ? (
        query ? (
          <EmptyState
            title={t.builds.emptyFilteredTitle}
            description={t.builds.emptyFilteredDescription}
            action={
              <Link href="/builds" className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium transition-colors hover:bg-current/5">
                {t.builds.resetSearch}
              </Link>
            }
          />
        ) : (
          <EmptyState
            title={t.builds.emptyMineTitle}
            description={t.builds.emptyMineDescription}
            action={
              <div className="flex flex-wrap justify-center gap-3">
                <Link
                  href="/builds?neu=1"
                  className="rounded-md bg-x-cyan px-4 py-2 text-sm font-medium text-base-dark transition-colors hover:bg-x-cyan/85"
                >
                  {t.builds.newBuild}
                </Link>
                <Link
                  href="/collection?tab=katalog"
                  className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium transition-colors hover:bg-current/5"
                >
                  {t.builds.browseCatalog}
                </Link>
              </div>
            }
          />
        )
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {builds.map((build) => (
            <li key={build.id}>
              <BuildCard
                build={{
                  id: build.id,
                  type: build.type,
                  blade: build.blade,
                  lockChip: build.lockChip,
                  overBlade: build.overBlade,
                  metalBlade: build.metalBlade,
                  assistBlade: build.assistBlade,
                  ratchet: build.ratchet,
                  bit: build.bit,
                  // [Fix while touching this object for productCode] name/isOfficialSet/imageId
                  // were never passed here, so BuildCard always fell back to the blade name and
                  // never showed the "Set" badge — even for official Sets like "Sword Dran 3-60F".
                  name: build.name,
                  isOfficialSet: build.isOfficialSet,
                  imageId: build.imageId,
                  productCode: build.productCode,
                }}
                winRate={winRates.get(build.id) ?? null}
              />
            </li>
          ))}
        </ul>
      )}
      {nextCursor && (
        <Link
          href={`/builds?${new URLSearchParams({ ...(query ? { q: query } : {}), cursor: nextCursor })}`}
          className="inline-block underline underline-offset-2"
        >
          {t.builds.loadMore}
        </Link>
      )}
      <p className="text-xs text-current/50">{t.builds.pageSize.replace('{size}', String(BUILD_PAGE_SIZE))}</p>
    </main>
  )
}
