// app/collection/[username]/page.tsx
// Another user's collection (Phase 5 Part B). Follows the /profile/[username] convention:
// the subject is projected through resolveVisibleFields BEFORE anything renders — the raw
// row never reaches the template. If view.collectionVisible is false the page 404s (not 403):
// existence isn't leaked (standing not-403 privacy policy, same as Phase 2's rulesets).
// Read-only — management UI lives on the owner's own /collection.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { resolveVisibleFields } from '@/lib/privacy'
import { isFriendWith } from '@/lib/friendship'
import { getRateTable, type FxCurrency } from '@/lib/currency'
import { EmptyState } from '@/components/ui/EmptyState'
import { CollectionItemCard } from '@/components/collection/CollectionItemCard'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20

export default async function UserCollectionPage({ params, searchParams }: PageProps<'/collection/[username]'>) {
  const { username } = await params
  const { cursor } = await searchParams
  const session = await auth()
  const viewerId = session?.user?.id ?? null

  // Exactly the field set lib/privacy.ts' SubjectUser requires — no raw-row overfetch.
  const subject = await prisma.user.findUnique({
    where: { username },
    select: {
      id: true, username: true, displayName: true, city: true, discordTag: true, bio: true,
      birthDate: true, isMinor: true, profileVisibility: true, locationVisibility: true,
      collectionVisibility: true, decksVisibility: true, ageVisibility: true,
    },
  })
  if (!subject) notFound()

  const isFriend = viewerId ? await isFriendWith(viewerId, subject.id) : false
  const view = resolveVisibleFields(subject, viewerId, isFriend)
  if (!view.collectionVisible) notFound()

  const [viewer, fx] = await Promise.all([
    viewerId
      ? prisma.user.findUnique({ where: { id: viewerId }, select: { country: true } })
      : Promise.resolve(null),
    getRateTable(),
  ])
  const target: FxCurrency = viewer?.country === 'CH' ? 'CHF' : 'EUR'

  const rows = await prisma.collectionItem.findMany({
    where: { userId: subject.id },
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
      <h1 className="text-2xl font-semibold">Sammlung von {view.displayName ?? view.username}</h1>

      {items.length === 0 ? (
        <EmptyState
          title="Diese Sammlung ist leer"
          description={`${view.username} hat noch keine Teile eingetragen.`}
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
        <Link href={`/collection/${subject.username}?cursor=${nextCursor}`} className="inline-block underline underline-offset-2">
          Weitere Teile laden
        </Link>
      )}
      {viewerId === subject.id && (
        <p className="text-sm text-current/60">
          Das ist deine eigene Sammlung — <Link href="/collection" className="underline underline-offset-2">zur Verwaltung</Link>.
        </p>
      )}
    </main>
  )
}
