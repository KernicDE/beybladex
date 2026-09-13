// app/collection/page.tsx
// The logged-in user's collection surface (Phase 5 Part B), RC16 (#102/#104) neu geordnet in
// zwei Tabs: "Katalog" (ALLE offiziellen Beyblades/Sets zum Durchstöbern — unabhängig vom
// Besitz, Klick führt zur Build-Detailseite /builds/[id]) und "Meine Sammlung" (eigene
// CollectionItems, ?neu=1 zeigt die Create-Formulare). Offizielle Sets leben also im Katalog,
// persönliche Kombis auf /builds. Per-user surface — force-dynamic per the caching half of
// the Regression Guard; guests get the explained GuestGate (RC8 #20) with a callbackUrl.
// Paginated (take/cursor) per the list-endpoint rule; the catalog tab pages via ?tab=katalog
// &kcursor= so the two cursors never interfere.
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getRateTable, type FxCurrency } from '@/lib/currency'
import { getDictionary } from '@/lib/i18n/server'
import { searchBuilds } from '@/lib/buildSearch'
import { getBuildStats } from '@/lib/metaCache'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Tabs, type TabDef } from '@/components/ui/Tabs'
import { BuildCard } from '@/components/beyblade/BuildCard'
import { CollectionItemCard } from '@/components/collection/CollectionItemCard'
import { CollectionItemForm } from '@/components/collection/CollectionItemForm'
import { MarkSetPurchasedForm } from '@/components/collection/MarkSetPurchasedForm'
import { GuestGate } from '@/components/auth/GuestGate'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20
const KATALOG_PAGE_SIZE = 20

export default async function CollectionPage({ searchParams }: PageProps<'/collection'>) {
  const { cursor, kcursor, neu, tab } = await searchParams
  // RC14-Nachzügler #130 — page chrome comes from the request dictionary.
  const t = await getDictionary()
  const session = await auth()
  if (!session?.user?.id) {
    return (
      <GuestGate
        title={t.collection.gateTitle}
        description={t.collection.gateDescription}
        callbackUrl="/collection"
        labels={t.guestGate}
      />
    )
  }

  const [viewer, fx, catalog] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id }, select: { country: true } }),
    getRateTable(),
    // Katalog-Tab (#102): alle offiziellen Sets, unabhängig vom Besitz.
    searchBuilds({
      cursor: typeof kcursor === 'string' ? kcursor : null,
      take: KATALOG_PAGE_SIZE,
      officialOnly: true,
    }),
  ])
  // No per-user currency preference exists in the schema — the hint target is inferred from
  // the viewer's country (CH → CHF, else EUR). See components/collection/PriceDisplay.tsx.
  const target: FxCurrency = viewer?.country === 'CH' ? 'CHF' : 'EUR'
  const catalogWinRates = await getBuildStats(catalog.builds.map((b) => b.id))

  const rows = await prisma.collectionItem.findMany({
    where: { userId: session.user.id },
    orderBy: { id: 'asc' },
    take: PAGE_SIZE + 1,
    ...(typeof cursor === 'string' && cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: {
      id: true, purchasePrice: true, currency: true, merchant: true, boughtAt: true,
      part: { select: { name: true, category: true, manufacturer: true, imageId: true } },
    },
  })
  const hasMore = rows.length > PAGE_SIZE
  const items = hasMore ? rows.slice(0, PAGE_SIZE) : rows
  const nextCursor = hasMore ? items[items.length - 1]!.id : null

  const mineContent = (
    <div className="space-y-6">
      {neu === '1' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <h3 className="mb-3 text-sm font-semibold">{t.collection.addSingle}</h3>
            <CollectionItemForm />
          </Card>
          <Card>
            <h3 className="mb-3 text-sm font-semibold">{t.collection.markSet}</h3>
            <MarkSetPurchasedForm />
          </Card>
        </div>
      )}

      {items.length === 0 && neu !== '1' ? (
        <EmptyState
          title={t.collection.emptyTitle}
          description={t.collection.emptyDescription}
          action={
            <Link href="/collection?neu=1" className="rounded-md bg-x-cyan px-4 py-2 text-sm font-medium text-base-dark transition-colors hover:bg-x-cyan/85">
              {t.collection.addFirst}
            </Link>
          }
        />
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.id}>
              <CollectionItemCard item={item} rates={fx.rates} stale={fx.stale} target={target} />
            </li>
          ))}
        </ul>
      )}
      {nextCursor && (
        <Link href={`/collection?cursor=${nextCursor}`} className="inline-block underline underline-offset-2">
          {t.collection.loadMore}
        </Link>
      )}
    </div>
  )

  const catalogContent = (
    <div className="space-y-6">
      {catalog.builds.length === 0 ? (
        <EmptyState title={t.collection.katalogEmptyTitle} description={t.collection.katalogEmptyDescription} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {catalog.builds.map((build) => (
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
                  isOfficialSet: build.isOfficialSet,
                  imageId: build.imageId,
                  productCode: build.productCode,
                }}
                winRate={catalogWinRates.get(build.id) ?? null}
              />
            </li>
          ))}
        </ul>
      )}
      {catalog.nextCursor && (
        <Link
          href={`/collection?tab=katalog&kcursor=${catalog.nextCursor}`}
          className="inline-block underline underline-offset-2"
        >
          {t.common.loadMore}
        </Link>
      )}
    </div>
  )

  const tabs: TabDef[] = [
    { id: 'mine', label: t.collection.tabMine, content: mineContent },
    { id: 'katalog', label: t.collection.tabCatalog, content: catalogContent },
  ]

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t.collection.heading}</h1>
        {items.length > 0 && (
          <Link href="/collection?neu=1" className="rounded-md bg-x-cyan px-4 py-2 text-sm font-medium text-base-dark transition-colors hover:bg-x-cyan/85">
            {t.collection.addPart}
          </Link>
        )}
      </div>

      <Tabs tabs={tabs} defaultTab={tab === 'katalog' ? 'katalog' : 'mine'} />
    </main>
  )
}
