// app/builds/page.tsx
// RC16 (#104): /builds ist die persönliche Build-Fläche. MVP4/4 (#144) — zwei Tabs nach dem
// UX-Baum in #139:
//   • "Meine Builds" — nur eigene Kombinationen (Login-Gate; "eigen" = alle Teile in der
//     eigenen Sammlung, denselbe onlyMineUserId-Filter wie GET /api/builds?onlyMine=1 — Builds
//     tragen keinen Owner-FK). Suche + Erstellen-Button (?neu=1, BuildComboPanel) wie bisher.
//   • "Öffentliche Builds" — visibility=PUBLIC aller User: Karten mit kanonischem Namen, Typ,
//     Rating-Summary (Batch-Aggregate) und Ersteller:in; Suche (Teilname) + Typ-Filter.
// Offizielle Sets leben seit MVP4 #141 im Beyblade-Modell und im Beyblades-Tab der Sammlung.
// Per-user surface — force-dynamic per the caching half of the Regression Guard; guests get
// the explained GuestGate (RC8 #20) with a callbackUrl. Cursor-paginated per the
// list-endpoint rule; beide Tabs cursoren über ?cursor= und tragen ihr tab= mit.
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { searchBuilds, BUILD_PAGE_SIZE } from '@/lib/buildSearch'
import { getBuildStats } from '@/lib/metaCache'
import { shapeRatingAggregates } from '@/lib/ratingAggregate'
import { getDictionary } from '@/lib/i18n/server'
import { BuildCard } from '@/components/beyblade/BuildCard'
import { BuildComboPanel } from '@/components/beyblade/BuildComboPanel'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Tabs, type TabDef } from '@/components/ui/Tabs'
import { GuestGate } from '@/components/auth/GuestGate'

export const dynamic = 'force-dynamic'

const BEY_TYPES = [
  { value: 'ATTACK', labelKey: 'typeAttack' },
  { value: 'DEFENSE', labelKey: 'typeDefense' },
  { value: 'STAMINA', labelKey: 'typeStamina' },
  { value: 'BALANCE', labelKey: 'typeBalance' },
] as const

function str(v: string | string[] | undefined): string {
  return typeof v === 'string' ? v : ''
}

export default async function BuildsPage({ searchParams }: PageProps<'/builds'>) {
  const { q, cursor, neu, tab, bt } = await searchParams
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

  const activeTab = tab === 'public' ? 'public' : 'mine'
  const query = str(q).trim()
  const typeFilter = str(bt)

  const { builds, nextCursor } = await searchBuilds({
    q: query,
    cursor: typeof cursor === 'string' ? cursor : null,
    onlyMineUserId: activeTab === 'mine' ? session.user.id : null,
    publicOnly: activeTab === 'public',
    type: activeTab === 'public' ? typeFilter || null : null,
  })
  // Auto-Meta badges (Phase 5 Part D): ONE batch mget for the whole page, never per-card
  // round trips. Whole-cache-empty falls back to a direct DB computation inside getBuildStats.
  const winRates = await getBuildStats(builds.map((b) => b.id))
  // #144 — User-Bewertungen der Seite als EIN Batch-groupBy (Öffentliche-Builds-Karten).
  const ratingRows = activeTab === 'public' && builds.length
    ? await prisma.rating.groupBy({
        by: ['targetId'],
        where: { targetType: 'BUILD', targetId: { in: builds.map((b) => b.id) } },
        _avg: { stars: true },
        _count: true,
      })
    : []
  const ratings = shapeRatingAggregates(ratingRows)

  const mineContent = (
    <div className="space-y-6">
      {neu === '1' && <BuildComboPanel />}

      <form role="search" action="/builds" className="flex items-center gap-2">
        <input type="hidden" name="tab" value="mine" />
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
                  href="/collection?tab=beyblades"
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
                  name: build.name,
                  imageId: build.imageId,
                }}
                winRate={winRates.get(build.id) ?? null}
              />
            </li>
          ))}
        </ul>
      )}
      {nextCursor && (
        <Link
          href={`/builds?${new URLSearchParams({ tab: 'mine', ...(query ? { q: query } : {}), cursor: nextCursor })}`}
          className="inline-block underline underline-offset-2"
        >
          {t.builds.loadMore}
        </Link>
      )}
      <p className="text-xs text-current/50">{t.builds.pageSize.replace('{size}', String(BUILD_PAGE_SIZE))}</p>
    </div>
  )

  const publicFilterActive = Boolean(query || typeFilter)
  const publicParams = new URLSearchParams({ tab: 'public' })
  if (query) publicParams.set('q', query)
  if (typeFilter) publicParams.set('bt', typeFilter)

  const publicContent = (
    <div className="space-y-6">
      <form role="search" action="/builds" className="grid items-end gap-3 sm:grid-cols-[1fr_auto_auto_auto]">
        <input type="hidden" name="tab" value="public" />
        <div>
          <label htmlFor="builds-public-q" className="mb-1 block text-sm">{t.builds.searchLabel}</label>
          <Input id="builds-public-q" name="q" type="search" defaultValue={query} placeholder={t.builds.searchPlaceholder} />
        </div>
        <div>
          <label htmlFor="builds-public-bt" className="mb-1 block text-sm">{t.catalog.type}</label>
          <Select id="builds-public-bt" name="bt" defaultValue={typeFilter}>
            <option value="">{t.catalog.typeAll}</option>
            {BEY_TYPES.map(({ value, labelKey }) => (
              <option key={value} value={value}>{t.catalog[labelKey]}</option>
            ))}
          </Select>
        </div>
        <button type="submit" className="rounded-md bg-x-cyan px-4 py-2 text-sm font-medium text-base-dark transition-colors hover:bg-x-cyan/85">
          {t.builds.search}
        </button>
        {publicFilterActive && (
          <Link href="/builds?tab=public" className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium transition-colors hover:bg-current/5">
            {t.catalog.reset}
          </Link>
        )}
      </form>

      {builds.length === 0 ? (
        <EmptyState
          title={publicFilterActive ? t.builds.publicEmptyFilteredTitle : t.builds.publicEmptyTitle}
          description={publicFilterActive ? t.builds.publicEmptyFilteredDescription : t.builds.publicEmptyDescription}
          action={publicFilterActive ? (
            <Link href="/builds?tab=public" className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium transition-colors hover:bg-current/5">
              {t.catalog.reset}
            </Link>
          ) : undefined}
        />
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
                  name: build.name,
                  imageId: build.imageId,
                }}
                winRate={winRates.get(build.id) ?? null}
                rating={ratings.get(build.id) ?? null}
                creator={build.creator?.username ?? null}
              />
            </li>
          ))}
        </ul>
      )}
      {nextCursor && (
        <Link
          href={`/builds?${(() => { const p = new URLSearchParams(publicParams); p.set('cursor', nextCursor); return p.toString() })()}`}
          className="inline-block underline underline-offset-2"
        >
          {t.builds.loadMore}
        </Link>
      )}
      <p className="text-xs text-current/50">{t.builds.pageSize.replace('{size}', String(BUILD_PAGE_SIZE))}</p>
    </div>
  )

  const tabs: TabDef[] = [
    { id: 'mine', label: t.builds.tabMine, content: mineContent },
    { id: 'public', label: t.builds.tabPublic, content: publicContent },
  ]

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t.builds.heading}</h1>
        {activeTab === 'mine' && builds.length > 0 && (
          <Link href="/builds?neu=1" className="rounded-md bg-x-cyan px-4 py-2 text-sm font-medium text-base-dark transition-colors hover:bg-x-cyan/85">
            {t.builds.newBuild}
          </Link>
        )}
      </div>
      <p className="text-current/70">
        {t.builds.intro}
      </p>

      <Tabs tabs={tabs} defaultTab={activeTab} />
    </main>
  )
}
