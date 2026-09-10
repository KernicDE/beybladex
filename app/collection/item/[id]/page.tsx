// app/collection/item/[id]/page.tsx
// CollectionItem detail + Preisverlauf (Phase 5 Part B). Note the path: the plan's literal
// "/collection/[id]" would collide with "/collection/[username]" (two dynamic segments with
// different names at the same level are ambiguous), so the item detail lives at the static
// "item" sub-segment, which wins over the dynamic [username] route — /collection/item/… can
// never be swallowed by a username match.
//
// Privacy: the owner sees everything plus edit/price/delete UI. Anyone else only gets the
// page if the OWNER's collectionVisibility permits it (resolveVisibleFields) — otherwise 404,
// not 403: the item's existence isn't leaked.
import { notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { resolveVisibleFields } from '@/lib/privacy'
import { isFriendWith } from '@/lib/friendship'
import { getRateTable, type FxCurrency } from '@/lib/currency'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { CardTitle } from '@/components/ui/Card'
import { PriceDisplay } from '@/components/collection/PriceDisplay'
import { PriceSparkline } from '@/components/collection/PriceSparkline'
import { CollectionItemForm } from '@/components/collection/CollectionItemForm'
import { CollectionDeleteButton } from '@/components/collection/CollectionDeleteButton'
import { PricePointForm } from '@/components/collection/PricePointForm'

export const dynamic = 'force-dynamic'

export default async function CollectionItemPage({ params }: PageProps<'/collection/item/[id]'>) {
  const { id } = await params
  const session = await auth()
  const viewerId = session?.user?.id ?? null

  const item = await prisma.collectionItem.findUnique({
    where: { id },
    select: {
      id: true, purchasePrice: true, currency: true, merchant: true, boughtAt: true,
      userId: true,
      part: { select: { id: true, name: true, category: true, manufacturer: true, beyType: true, imageId: true } },
      pricePoints: { orderBy: { recordedAt: 'asc' }, select: { id: true, price: true, currency: true, recordedAt: true } },
    },
  })
  if (!item) notFound()

  const isOwner = viewerId === item.userId
  if (!isOwner) {
    const owner = await prisma.user.findUnique({
      where: { id: item.userId },
      select: {
        id: true, username: true, displayName: true, city: true, discordTag: true, bio: true,
        birthDate: true, isMinor: true, profileVisibility: true, locationVisibility: true,
        collectionVisibility: true, decksVisibility: true, ageVisibility: true,
      },
    })
    if (!owner) notFound()
    const isFriend = viewerId ? await isFriendWith(viewerId, owner.id) : false
    const view = resolveVisibleFields(owner, viewerId, isFriend)
    if (!view.collectionVisible) notFound()
  }

  const [viewer, fx] = await Promise.all([
    viewerId
      ? prisma.user.findUnique({ where: { id: viewerId }, select: { country: true } })
      : Promise.resolve(null),
    getRateTable(),
  ])
  const target: FxCurrency = viewer?.country === 'CH' ? 'CHF' : 'EUR'

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{item.part.name}</h1>
        <Badge tone="neutral">{item.part.category}</Badge>
        <Badge tone="neutral">{item.part.manufacturer}</Badge>
        {item.part.beyType && <Badge tone="cyan">{item.part.beyType}</Badge>}
      </div>

      <Card className="space-y-2">
        <p className="text-lg">
          <PriceDisplay price={item.purchasePrice} currency={item.currency} target={target} rates={fx.rates} stale={fx.stale} />
        </p>
        {(item.merchant || item.boughtAt) && (
          <p className="text-sm text-current/60">
            {[
              item.merchant,
              item.boughtAt ? `Gekauft am ${new Date(item.boughtAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}` : null,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
      </Card>

      <Card className="space-y-3">
        <CardTitle>Preisverlauf</CardTitle>
        {item.pricePoints.length < 2 ? (
          <p className="text-sm text-current/60">
            {item.pricePoints.length === 0
              ? 'Noch keine Preisbeobachtungen — trage den aktuellen Wert unten ein.'
              : 'Erst eine Preisbeobachtung — der Verlauf erscheint ab dem zweiten Eintrag.'}
          </p>
        ) : (
          <>
            <PriceSparkline points={item.pricePoints} />
            <ul className="space-y-1 text-sm">
              {item.pricePoints.map((p) => (
                <li key={p.id} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-current/60">{new Date(p.recordedAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}</span>
                  <PriceDisplay price={p.price} currency={p.currency} target={target} rates={fx.rates} stale={fx.stale} />
                </li>
              ))}
            </ul>
          </>
        )}
        {isOwner && <PricePointForm itemId={item.id} />}
      </Card>

      {isOwner && (
        <>
          <Card className="space-y-3">
            <CardTitle>Eintrag bearbeiten</CardTitle>
            <CollectionItemForm
              existing={{
                id: item.id,
                part: { id: item.part.id, name: item.part.name },
                purchasePrice: item.purchasePrice,
                currency: item.currency,
                merchant: item.merchant,
                boughtAt: item.boughtAt,
              }}
            />
          </Card>
          <CollectionDeleteButton itemId={item.id} />
        </>
      )}
    </main>
  )
}
