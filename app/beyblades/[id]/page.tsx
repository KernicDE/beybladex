// app/beyblades/[id]/page.tsx (MVP4, #139/#141/#142/#143)
// Beyblade-Detailseite (offizielles Set) — Minimal-Version zum Build-Split: Teile, abgeleiteter
// Typ/Spinrichtung, Hersteller, Product Code, Set-Bild. Seit #142: Kauf-Flow (Formular +
// eigene Käufe, logged-in) und der öffentliche Preisverlauf. Seit #143: polymorphe Bewertung
// (Durchschnitt im Header, Formular + Liste für eigene/alle). Die restliche IA/UX baut in
// #144 auf („Build daraus erstellen").
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { TypeBadge } from '@/components/beyblade/TypeBadge'
import { PurchaseForm } from '@/components/beyblade/PurchaseForm'
import { PurchaseList } from '@/components/beyblade/PurchaseList'
import { RatingForm } from '@/components/beyblade/RatingForm'
import { RatingList } from '@/components/beyblade/RatingList'
import { RatingSummary } from '@/components/beyblade/RatingSummary'
import { PriceSparkline } from '@/components/collection/PriceSparkline'
import { deriveAssemblyTraits } from '@/lib/assembly'
import { formatBitDisplay } from '@/lib/buildNaming'
import { shapePriceHistory } from '@/lib/purchasePriceHistory'
import { shapeRatingAggregate } from '@/lib/ratingAggregate'

export const dynamic = 'force-dynamic'

const RATING_PAGE_SIZE = 20

export default async function BeybladeDetailPage({ params }: PageProps<'/beyblades/[id]'>) {
  const { id } = await params

  const beyblade = await prisma.beyblade.findUnique({
    where: { id },
    include: {
      blade: true,
      lockChip: true,
      overBlade: true,
      metalBlade: true,
      assistBlade: true,
      ratchet: true,
      bit: true,
    },
  })
  if (!beyblade) notFound()

  const session = await auth()

  // #142 — eigene Käufe (Edit/Delete-Liste) und der öffentliche Preisverlauf.
  const [ownPurchases, priceRows] = await Promise.all([
    session?.user?.id
      ? prisma.purchase.findMany({
          where: { userId: session.user.id, beybladeId: id },
          orderBy: { createdAt: 'desc' },
          select: { id: true, merchant: true, boughtAt: true, price: true, currency: true, createdAt: true },
        })
      : Promise.resolve([]),
    prisma.purchase.findMany({
      where: { beybladeId: id, price: { not: null } },
      select: { price: true, currency: true, boughtAt: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }),
  ])
  const priceHistory = shapePriceHistory(priceRows)

  // #143 — polymorphe Bewertung (targetType BEYBLADE): Durchschnitt/Anzahl fürs Header-Highlight
  // plus die erste Seite der Liste. `own` hängt am Viewer, Moderation an TRUSTED/ADMIN.
  const viewerId = session?.user?.id ?? null
  const viewer = viewerId
    ? await prisma.user.findUnique({ where: { id: viewerId }, select: { role: true } })
    : null
  const canModerate = viewer?.role === 'TRUSTED' || viewer?.role === 'ADMIN'

  const [ratingAggRow, beybladeRatings] = await Promise.all([
    prisma.rating.aggregate({ where: { targetType: 'BEYBLADE', targetId: id }, _avg: { stars: true }, _count: true }),
    prisma.rating.findMany({
      where: { targetType: 'BEYBLADE', targetId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: RATING_PAGE_SIZE,
      include: { user: { select: { id: true, username: true } } },
    }),
  ])
  const ratingAggregate = shapeRatingAggregate(ratingAggRow)
  const ownRating = viewerId ? beybladeRatings.find((r) => r.user.id === viewerId) : undefined

  const traits = deriveAssemblyTraits(beyblade.blade, beyblade.lockChip)

  const parts = [
    { label: 'Lock Chip', part: beyblade.lockChip },
    { label: 'Blade', part: beyblade.blade },
    { label: 'Over Blade', part: beyblade.overBlade },
    { label: 'Metal Blade', part: beyblade.metalBlade },
    { label: 'Assist Blade', part: beyblade.assistBlade },
    { label: 'Ratchet', part: beyblade.ratchet },
    { label: 'Bit', part: beyblade.bit },
  ].filter((p): p is { label: string; part: (typeof p.part & object) } => p.part !== null)

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <Link href="/collection?tab=katalog" className="text-sm text-current/60 underline underline-offset-2">← Katalog</Link>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">
              {beyblade.name}
              {beyblade.productCode && <span className="ml-2 text-base font-normal text-current/50">{beyblade.productCode}</span>}
            </h1>
            <p className="text-current/60">
              {/* RC16 (#106): Bit als „Kurzcode (Vollname)". */}
              {parts.map((p) => (p.part.category === 'BIT' ? formatBitDisplay(p.part.name) : p.part.name)).join(' · ')}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <Badge tone="neutral">{beyblade.manufacturer}</Badge>
              {traits?.spinDirection && (
                <Badge tone="neutral">{traits.spinDirection === 'RIGHT' ? 'Rechtsdrehend' : 'Linksdrehend'}</Badge>
              )}
            </div>
            {ratingAggregate.count > 0 && (
              <div className="mt-2">
                <RatingSummary aggregate={ratingAggregate} />
              </div>
            )}
          </div>
          {traits?.beyType && <TypeBadge type={traits.beyType} />}
        </div>
      </Card>

      <section aria-labelledby="beyblade-parts" className="space-y-3">
        <h2 id="beyblade-parts" className="text-lg font-semibold">Teile</h2>
        <ul className="grid gap-3 sm:grid-cols-3">
          {parts.map(({ label, part }) => (
            <li key={part.id}>
              <Link href={`/parts/${part.id}`} className="block transition-opacity hover:opacity-80">
                <Card className="h-full p-4 text-center">
                  {part.imageId ? (
                    <Image
                      src={`/api/media/${part.imageId}`}
                      alt={part.name}
                      width={96}
                      height={96}
                      sizes="96px"
                      className="mx-auto h-24 w-24 rounded-lg object-contain"
                    />
                  ) : (
                    <div aria-hidden="true" className="mx-auto h-24 w-24 rounded-lg bg-x-cyan/10" />
                  )}
                  <p className="mt-2 font-medium">
                    {part.category === 'BIT' ? formatBitDisplay(part.name) : part.name}
                  </p>
                  <p className="text-sm text-current/60">{label}</p>
                  <div className="mt-1 flex justify-center gap-1">
                    <Badge tone="cyan">{part.category}</Badge>
                    {part.beyType && <TypeBadge type={part.beyType} />}
                  </div>
                  {part.weightGrams && <p className="mt-1 text-xs text-current/50">{part.weightGrams} g</p>}
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* #143 — polymorphe Bewertung: Formular (logged-in, editiert via Upsert) + Liste.
          Eigene Bewertung ist direkt editierbar; Moderation (TRUSTED/ADMIN) entfernt fremde. */}
      <section aria-labelledby="beyblade-ratings" className="space-y-3">
        <h2 id="beyblade-ratings" className="text-lg font-semibold">Bewertungen</h2>
        {viewerId ? (
          <Card>
            <RatingForm
              targetType="BEYBLADE"
              targetId={id}
              placeholder="Wie spielt sich dieser Beyblade?"
              existing={ownRating ? { ratingId: ownRating.id, stars: ownRating.stars, comment: ownRating.comment } : null}
            />
          </Card>
        ) : (
          <Card className="text-sm text-current/70">
            <Link href="/login" className="underline underline-offset-2">Melde dich an</Link>, um diesen Beyblade zu bewerten.
          </Card>
        )}
        <RatingList
          targetType="BEYBLADE"
          targetId={id}
          canModerate={canModerate}
          emptyDescription="Sei die erste Person, die diesen Beyblade bewertet."
          ratings={beybladeRatings.map((r) => ({
            id: r.id,
            stars: r.stars,
            comment: r.comment,
            createdAt: r.createdAt.toISOString(),
            username: r.user.username,
            own: r.user.id === viewerId,
          }))}
        />
      </section>

      {/* #142 — Kauf-Flow: jeder angemeldete User kann (auch mehrfach) als gekauft markieren.
          Gäste sehen den Bereich nicht — markieren ist ein Account-Feature (#139). */}
      {session?.user?.id && (
        <section aria-labelledby="beyblade-purchase" className="space-y-3">
          <h2 id="beyblade-purchase" className="text-lg font-semibold">Kauf</h2>
          <Card className="p-4">
            <h3 className="mb-3 text-sm font-semibold">Als gekauft markieren</h3>
            <PurchaseForm beybladeId={beyblade.id} />
          </Card>
          {ownPurchases.length > 0 && (
            <PurchaseList
              purchases={ownPurchases.map((p) => ({
                ...p,
                boughtAt: p.boughtAt ? p.boughtAt.toISOString() : null,
                createdAt: p.createdAt.toISOString(),
              }))}
            />
          )}
        </section>
      )}

      {/* #142 — Preisverlauf: öffentlich, alle gemeldeten Kaufpreise gruppiert nach Währung. */}
      <section aria-labelledby="beyblade-price-history" className="space-y-3">
        <h2 id="beyblade-price-history" className="text-lg font-semibold">Preisverlauf</h2>
        {Object.keys(priceHistory).length === 0 ? (
          <EmptyState title="Noch keine Preisdaten" description="Sobald Käufe mit Preisangabe gemeldet werden, erscheint hier der Verlauf." />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {Object.entries(priceHistory).map(([currency, points]) => (
              <li key={currency}>
                <Card className="p-4">
                  <p className="mb-2 text-sm font-semibold">
                    {currency} · {points.length} {points.length === 1 ? 'Datenpunkt' : 'Datenpunkte'}
                  </p>
                  <PriceSparkline
                    points={points.map((p) => ({ price: p.price, recordedAt: p.date }))}
                  />
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
