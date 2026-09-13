// app/parts/[id]/page.tsx (RC16 #105; #108 Kuratoren-Edit, #106 Bit-Anzeige; MVP4 #141/#143)
// Oeffentliche Einzelteil-Detailseite (Blade/Ratchet/Bit/…): Name, Kategorie, Hersteller,
// Bey-Typ, Gewicht, Bild plus Auto-Meta-Winrate (getPartStats), der polymorphen User-Bewertung
// (#143 — targetType PART, Durchschnitt im Header, Formular + Liste) und den Rueckverweisen, in
// welchen Beyblades (offizielle Sets) und Builds (persönliche Kombis) das Teil vorkommt —
// OR über alle 7 Slot-FKs via lib/assembly.ts partOccurrenceWhere (DIE Occurrence-Stelle,
// RC16 #122). Oeffentliche Katalog-Oberflaeche; seit #108 aber force-dynamic — das Kuratoren-
// Formular (PartForm, Direct-Authoring-Tier TRUSTED/ADMIN, gleiche Gate-Logik wie
// app/settings/admin/parts) darf nicht in den Full-Route-Cache fuer Gaeste geraten. Bits
// rendern als „Kurzcode (Vollname)" (#106).
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { BuildCard } from '@/components/beyblade/BuildCard'
import { TypeBadge } from '@/components/beyblade/TypeBadge'
import { WinRateBadge } from '@/components/beyblade/WinRateBadge'
import { RatingForm } from '@/components/beyblade/RatingForm'
import { RatingList } from '@/components/beyblade/RatingList'
import { RatingSummary } from '@/components/beyblade/RatingSummary'
import { PartForm } from '@/components/admin/PartForm'
import { EditToggle } from '@/components/admin/EditToggle'
import { getBuildStats, getPartStats } from '@/lib/metaCache'
import { partOccurrenceWhere } from '@/lib/assembly'
import { formatBitDisplay } from '@/lib/buildNaming'
import { shapeRatingAggregate } from '@/lib/ratingAggregate'

export const dynamic = 'force-dynamic'

const BUILDS_PER_PAGE = 50
const RATING_PAGE_SIZE = 20

const BUILD_INCLUDE = {
  blade: { select: { id: true, name: true, imageId: true, beyType: true } },
  lockChip: { select: { id: true, name: true } },
  overBlade: { select: { id: true, name: true } },
  metalBlade: { select: { id: true, name: true } },
  assistBlade: { select: { id: true, name: true } },
  ratchet: { select: { id: true, name: true } },
  bit: { select: { id: true, name: true } },
} as const

export default async function PartDetailPage({ params }: PageProps<'/parts/[id]'>) {
  const { id } = await params
  const session = await auth()
  const part = await prisma.part.findUnique({ where: { id } })
  if (!part) notFound()

  // RC16 (#108): Direct-Authoring-Tier (TRUSTED/ADMIN, gleiche Logik wie
  // app/settings/admin/parts/page.tsx) sieht den Bearbeiten-Modus — der Server (/api/admin/parts)
  // bleibt das eigentliche Authz-Gate.
  const caller = session?.user?.id
    ? await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
    : null
  const canAuthor = caller?.role === 'TRUSTED' || caller?.role === 'ADMIN'

  const [stats, builds, beyblades] = await Promise.all([
    getPartStats([id]),
    prisma.build.findMany({
      // Rueckverweis (persönliche Builds): ein Teil kann in jedem der 7 Slots stecken
      // (RC16 #122 — je nach Bauform).
      where: partOccurrenceWhere(id),
      orderBy: { id: 'asc' },
      take: BUILDS_PER_PAGE,
      include: BUILD_INCLUDE,
    }),
    prisma.beyblade.findMany({
      // Rueckverweis (offizielle Sets) — dasselbe Occurrence-where auf dem Beyblade-Modell.
      where: partOccurrenceWhere(id),
      orderBy: { id: 'asc' },
      take: BUILDS_PER_PAGE,
      include: {
        blade: { select: { id: true, name: true, imageId: true, beyType: true } },
        lockChip: { select: { id: true, name: true, beyType: true } },
        overBlade: { select: { id: true, name: true } },
        metalBlade: { select: { id: true, name: true } },
        assistBlade: { select: { id: true, name: true } },
        ratchet: { select: { id: true, name: true } },
        bit: { select: { id: true, name: true } },
      },
    }),
  ])
  const winRates = await getBuildStats(builds.map((b) => b.id))

  // #143 — polymorphe Bewertung (targetType PART): Durchschnitt/Anzahl fürs Header-Highlight
  // plus die erste Seite der Liste. Teil-Ratings sind neu (vorher nur Builds). User-Sterne
  // (RatingSummary) und Auto-Meta-Winrate (WinRateBadge) bleiben getrennte Angaben.
  const viewerId = session?.user?.id ?? null
  const [ratingAggRow, partRatings] = await Promise.all([
    prisma.rating.aggregate({ where: { targetType: 'PART', targetId: id }, _avg: { stars: true }, _count: true }),
    prisma.rating.findMany({
      where: { targetType: 'PART', targetId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: RATING_PAGE_SIZE,
      include: { user: { select: { id: true, username: true } } },
    }),
  ])
  const ratingAggregate = shapeRatingAggregate(ratingAggRow)
  const ownRating = viewerId ? partRatings.find((r) => r.user.id === viewerId) : undefined

  const displayName = part.category === 'BIT' ? formatBitDisplay(part.name) : part.name

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <Link href="/collection?tab=teile" className="text-sm text-current/60 underline underline-offset-2">← Teile</Link>

      <Card>
        <div className="flex flex-wrap items-start gap-4">
          {part.imageId ? (
            <Image
              src={`/api/media/${part.imageId}`}
              alt={part.name}
              width={96}
              height={96}
              sizes="96px"
              className="h-24 w-24 rounded-lg object-contain"
            />
          ) : (
            <div aria-hidden="true" className="h-24 w-24 rounded-lg bg-x-cyan/10" />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold">{displayName}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <Badge tone="cyan">{part.category}</Badge>
              <Badge tone="neutral">{part.manufacturer}</Badge>
              {part.beyType && <TypeBadge type={part.beyType} />}
              <Badge tone="neutral">{part.spinDirection === 'RIGHT' ? 'Rechtsdrehend' : 'Linksdrehend'}</Badge>
              {part.dualSpin && <Badge tone="cyan">Dual Spin</Badge>}
              {part.isRatchetIntegrated && <Badge tone="cyan">Ratchet-integriert</Badge>}
            </div>
            <div className="mt-2">
              <WinRateBadge stats={stats.get(id) ?? null} />
            </div>
            {ratingAggregate.count > 0 && (
              <div className="mt-2">
                <RatingSummary aggregate={ratingAggregate} />
              </div>
            )}
            {part.weightGrams && <p className="mt-1 text-sm text-current/60">{part.weightGrams} g</p>}
          </div>
        </div>
      </Card>

      {/* #143 — polymorphe Bewertung (Teil-Ratings sind neu — vorher nur Builds): Formular
          (logged-in, editiert via Upsert) + Liste. Moderation = TRUSTED/ADMIN (wie canAuthor). */}
      <section aria-labelledby="part-ratings" className="space-y-3">
        <h2 id="part-ratings" className="text-lg font-semibold">Bewertungen</h2>
        {viewerId ? (
          <Card>
            <RatingForm
              targetType="PART"
              targetId={id}
              placeholder="Wie spielt sich dieses Teil?"
              existing={ownRating ? { ratingId: ownRating.id, stars: ownRating.stars, comment: ownRating.comment } : null}
            />
          </Card>
        ) : (
          <Card className="text-sm text-current/70">
            <Link href="/login" className="underline underline-offset-2">Melde dich an</Link>, um dieses Teil zu bewerten.
          </Card>
        )}
        <RatingList
          targetType="PART"
          targetId={id}
          canModerate={canAuthor}
          emptyDescription="Sei die erste Person, die dieses Teil bewertet."
          ratings={partRatings.map((r) => ({
            id: r.id,
            stars: r.stars,
            comment: r.comment,
            createdAt: r.createdAt.toISOString(),
            username: r.user.username,
            own: r.user.id === viewerId,
          }))}
        />
      </section>

      <section aria-labelledby="part-beyblades" className="space-y-3">
        <h2 id="part-beyblades" className="text-lg font-semibold">
          In {beyblades.length} Beyblade{beyblades.length === 1 ? '' : 's'} (Sets) enthalten
        </h2>
        {beyblades.length === 0 ? (
          <EmptyState
            title="In keinem Set enthalten"
            description="Sobald offizielle Sets mit diesem Teil im Katalog sind, erscheinen sie hier."
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {beyblades.map((beyblade) => (
              <li key={beyblade.id}>
                <BuildCard
                  build={{
                    id: beyblade.id,
                    type: beyblade.blade?.beyType ?? beyblade.lockChip?.beyType ?? 'BALANCE',
                    blade: beyblade.blade,
                    lockChip: beyblade.lockChip,
                    overBlade: beyblade.overBlade,
                    metalBlade: beyblade.metalBlade,
                    assistBlade: beyblade.assistBlade,
                    ratchet: beyblade.ratchet,
                    bit: beyblade.bit,
                    name: beyblade.name,
                    imageId: beyblade.imageId,
                  }}
                  href={`/beyblades/${beyblade.id}`}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="part-builds" className="space-y-3">
        <h2 id="part-builds" className="text-lg font-semibold">In {builds.length} Build{builds.length === 1 ? '' : 's'} enthalten</h2>
        {builds.length === 0 ? (
          <EmptyState
            title="Noch in keinem Build"
            description="Sobald Builds mit diesem Teil im Katalog sind, erscheinen sie hier."
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
                />
              </li>
            ))}
          </ul>
        )}
      </section>
      {canAuthor && (
        <section aria-labelledby="part-edit" className="space-y-3">
          <h2 id="part-edit" className="text-lg font-semibold">Kuratieren</h2>
          <Card>
            <EditToggle label="Teil bearbeiten">
              <PartForm
                initial={{
                  id: part.id,
                  name: part.name,
                  manufacturer: part.manufacturer,
                  category: part.category,
                  beyType: part.beyType ?? '',
                  spinDirection: part.spinDirection,
                  weightGrams: part.weightGrams?.toString() ?? '',
                  imageId: part.imageId,
                  isRatchetIntegrated: part.isRatchetIntegrated,
                }}
              />
            </EditToggle>
          </Card>
        </section>
      )}
    </main>
  )
}
