// app/collection/page.tsx
// The logged-in user's OWN collection (Phase 5 Part B). Per-user surface — force-dynamic per
// the caching half of the Regression Guard. Paginated (take/cursor) per the list-endpoint
// rule; empty state carries the "Füge dein erstes Teil hinzu" CTA (standing empty-state rule),
// ?neu=1 reveals the create form (same convention as /decks). Another user's collection lives
// at /collection/[username], gated by resolveVisibleFields there — never here.
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getRateTable, type FxCurrency } from '@/lib/currency'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { CollectionItemCard } from '@/components/collection/CollectionItemCard'
import { CollectionItemForm } from '@/components/collection/CollectionItemForm'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20

export default async function CollectionPage({ searchParams }: PageProps<'/collection'>) {
  const { cursor, neu } = await searchParams
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const [viewer, fx] = await Promise.all([
    prisma.user.findUnique({ where: { id: session.user.id }, select: { country: true } }),
    getRateTable(),
  ])
  // No per-user currency preference exists in the schema — the hint target is inferred from
  // the viewer's country (CH → CHF, else EUR). See components/collection/PriceDisplay.tsx.
  const target: FxCurrency = viewer?.country === 'CH' ? 'CHF' : 'EUR'

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

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Meine Sammlung</h1>
        {items.length > 0 && (
          <Link href="/collection?neu=1" className="rounded-md bg-x-cyan px-4 py-2 text-sm font-medium text-base-dark transition-colors hover:bg-x-cyan/85">
            Teil hinzufügen
          </Link>
        )}
      </div>

      {neu === '1' && (
        <Card>
          <CollectionItemForm />
        </Card>
      )}

      {items.length === 0 && neu !== '1' ? (
        <EmptyState
          title="Noch keine Teile in deiner Sammlung"
          description="Trage ein, welche Teile du besitzt — mit Kaufpreis, Händler und Kaufdatum."
          action={
            <Link href="/collection?neu=1" className="rounded-md bg-x-cyan px-4 py-2 text-sm font-medium text-base-dark transition-colors hover:bg-x-cyan/85">
              Füge dein erstes Teil hinzu
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
          Weitere Teile laden
        </Link>
      )}
    </main>
  )
}
