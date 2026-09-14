// app/builds/[id]/page.tsx
// Build detail (Phase 5 Part A): the combo page spec §2.A promises — parts with images,
// TypeBadge, and the rating/comment area below (list + form). The rating section is
// per-user/live, so this page is force-dynamic per the caching half of the Regression Guard.
// MVP4 (#143): Die Bewertungen laufen über die polymorphe Rating-API (targetType BUILD).
// MVP4/4 (#144): User-Bewertungen (RatingSummary + Bewertungs-Section) und Turnier-
// Statistiken (Auto-Meta, WinRateBadge aus lib/meta) sind als getrennte, beschriftete
// Bereiche sichtbar — User-Meinung ≠ Turnier-Statistik. Ersteller:in sieht den
// Öffentlich/Ungelistet-Umschalter (BuildVisibilityToggle → PATCH /api/builds/[id]).
// MVP4/5 (#145): Name/Typ-Bearbeitung ist ebenfalls Ersteller-only (derselbe PATCH); der
// Vor-Split-Kuratoren-Edit (/api/admin/builds/[id]) wurde entfernt — Builds sind eine reine
// Nutzersache, offizielle Sets leben im Beyblade-Modell. #161: die frühere separate
// "Build bearbeiten"-Box (BuildEditForm) ist einem Inline-Edit-Modus gewichen
// (BuildTitleEditable — verwandelt Titel/Typ-Badge selbst in Eingabefelder), dazu ein
// Lösch-Button (BuildDeleteButton, DELETE /api/builds/[id]).
import Image from 'next/image'
import Link from 'next/link'
import { BackLink } from '@/components/ui/BackLink'
import { notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { RatingForm } from '@/components/beyblade/RatingForm'
import { RatingList } from '@/components/beyblade/RatingList'
import { RatingSummary } from '@/components/beyblade/RatingSummary'
import { TypeBadge } from '@/components/beyblade/TypeBadge'
import { WinRateBadge } from '@/components/beyblade/WinRateBadge'
import { BuildVisibilityToggle } from '@/components/beyblade/BuildVisibilityToggle'
import { BuildTitleEditable } from '@/components/beyblade/BuildTitleEditable'
import { BuildDeleteButton } from '@/components/beyblade/BuildDeleteButton'
import { BuildPartsEditor } from '@/components/beyblade/BuildPartsEditor'
import { getBuildStats, getPartStats } from '@/lib/metaCache'
import { formatBitDisplay } from '@/lib/buildNaming'
import { shapeRatingAggregate } from '@/lib/ratingAggregate'

export const dynamic = 'force-dynamic'

const RATING_PAGE_SIZE = 20

export default async function BuildDetailPage({ params }: PageProps<'/builds/[id]'>) {
  const { id } = await params
  const session = await auth()
  const viewerId = session?.user?.id ?? null

  const build = await prisma.build.findUnique({
    where: { id },
    include: {
      // #144 — Ersteller:in für die Zeile im Header (null bei Vor-MVP4-Rows).
      creator: { select: { username: true } },
      blade: true,
      lockChip: true,
      overBlade: true,
      metalBlade: true,
      assistBlade: true,
      ratchet: true,
      bit: true,
    },
  })
  if (!build) notFound()

  // MVP4 (#141): Ratings sind polymorph — die Build-Bewertungen werden separat gelesen
  // (keine Prisma-Relation mehr, targetId trägt keine FK).
  const buildRatings = await prisma.rating.findMany({
    where: { targetType: 'BUILD', targetId: id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: RATING_PAGE_SIZE,
    include: { user: { select: { id: true, username: true } } },
  })

  let canModerate = false
  let viewerUsername: string | null = null
  if (viewerId) {
    const caller = await prisma.user.findUnique({ where: { id: viewerId }, select: { role: true, username: true } })
    // Bewertungs-Moderation bleibt TRUSTED/ADMIN; Build-Bearbeitung ist seit #145 ausschließlich
    // Ersteller-Sache (kein Kuratoren-Schreibweg mehr am Build-Modell).
    canModerate = caller?.role === 'TRUSTED' || caller?.role === 'ADMIN'
    viewerUsername = caller?.username ?? null
  }

  const aggregate = shapeRatingAggregate(
    await prisma.rating.aggregate({ where: { targetType: 'BUILD', targetId: id }, _avg: { stars: true }, _count: true }),
  )
  const ownRating = viewerUsername ? buildRatings.find((r) => r.user.id === viewerId) : undefined

  // Auto-Meta win rates (Phase 5 Part D) — batch cache reads (single-key for the build, one
  // mget for its parts), with direct-compute fallback on an empty cache. RC16 (#122): über
  // alle belegten Slots (2–6 je nach Bauform).
  const parts = [
    { label: 'Lock Chip', part: build.lockChip },
    { label: 'Blade', part: build.blade },
    { label: 'Over Blade', part: build.overBlade },
    { label: 'Metal Blade', part: build.metalBlade },
    { label: 'Assist Blade', part: build.assistBlade },
    { label: 'Ratchet', part: build.ratchet },
    { label: 'Bit', part: build.bit },
  ].filter((p): p is { label: string; part: (typeof p.part & object) } => p.part !== null)

  const [buildStats, partStats] = await Promise.all([
    getBuildStats([id]),
    getPartStats(parts.map((p) => p.part.id)),
  ])

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <BackLink href="/builds">Alle Builds</BackLink>

      <Card>
        {/* Titel: kanonischer/vergebener Name → Blade → Lock Chip → Bit (RC16 #122). #161 —
            für die Erstellerin bzw. den Ersteller ist dieser Block selbst der Bearbeiten-Modus
            (BuildTitleEditable), nicht mehr nur eine statische Anzeige + separate Box darunter. */}
        {viewerId && build.creatorId === viewerId ? (
          <BuildTitleEditable
            buildId={build.id}
            displayName={build.name ?? build.blade?.name ?? build.lockChip?.name ?? build.bit.name}
            initialName={build.name ?? ''}
            initialType={build.type}
          />
        ) : (
          <div className="flex flex-wrap items-start justify-between gap-3">
            <h1 className="text-2xl font-semibold">
              {build.name ?? build.blade?.name ?? build.lockChip?.name ?? build.bit.name}
            </h1>
            <TypeBadge type={build.type} />
          </div>
        )}
        <p className="text-current/60">
          {/* RC16 (#106): Bit als „Kurzcode (Vollname)". */}
          {parts.map((p) => (p.part.category === 'BIT' ? formatBitDisplay(p.part.name) : p.part.name)).join(' · ')}
        </p>
        {aggregate.count > 0 && (
          <div className="mt-2">
            <RatingSummary aggregate={aggregate} />
          </div>
        )}
        {/* #144 — Ersteller:in (Öffentliche-Builds-Karten zeigen denselben Wert). */}
        {build.creator && (
          <p className="mt-1 text-sm text-current/50">
            Erstellt von{' '}
            <Link href={`/profile/${encodeURIComponent(build.creator.username)}`} className="underline underline-offset-2">
              {build.creator.username}
            </Link>
          </p>
        )}
        {/* #144 — Sichtbarkeits-Umschalter; #161 — Lösch-Button daneben. Beide nur für die
            Erstellerin bzw. den Ersteller. */}
        {viewerId && build.creatorId === viewerId && (
          <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
            <BuildVisibilityToggle buildId={build.id} initial={build.visibility} />
            <BuildDeleteButton buildId={build.id} />
          </div>
        )}
      </Card>

      <section aria-labelledby="build-parts" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="build-parts" className="text-lg font-semibold">Teile</h2>
          {/* #164 — "Teile ändern" nur für die Erstellerin/den Ersteller UND nur für die
              Standard-Bauform (Blade+Ratchet+Bit ohne Lock Chip) — CX-/Ratchet-Integrated-Sets
              sind offizielle Retail-Produkte, siehe BuildPartsEditor. */}
          {viewerId && build.creatorId === viewerId && build.blade && build.ratchet && !build.lockChip && (
            <BuildPartsEditor
              currentBuildId={build.id}
              initial={{
                blade: { id: build.blade.id, name: build.blade.name },
                ratchet: { id: build.ratchet.id, name: build.ratchet.name },
                bit: { id: build.bit.id, name: build.bit.name },
                type: build.type,
              }}
            />
          )}
        </div>
        <ul className="grid gap-3 sm:grid-cols-3">
          {parts.map(({ label, part }) => (
            <li key={part.id}>
              {/* RC16 (#105): die Teile-Karte verlinkt auf die neue Einzelteil-Detailseite. */}
              {/* #164 — einheitliche Boxgröße: flex-col + für optionale Zeilen (Typ-Badge,
                  Gewicht) immer denselben Platz reservieren (invisible statt weggelassen),
                  damit nicht jede Karte je nach Bauform/Teileart eine andere Höhe bekommt. */}
              <Link href={`/parts/${part.id}`} className="block h-full transition-opacity hover:opacity-80">
              <Card className="flex h-full flex-col items-center p-4 text-center">
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
                <p className="mt-2 font-medium">
                  {/* RC16 (#106): Bit als „Kurzcode (Vollname)" — „F (Flat)". */}
                  {part.category === 'BIT' ? formatBitDisplay(part.name) : part.name}
                </p>
                <p className="text-sm text-current/60">{label}</p>
                <div className="mt-1 flex justify-center gap-1">
                  <Badge tone="cyan">{part.category}</Badge>
                  <TypeBadge type={part.beyType ?? 'BALANCE'} className={part.beyType ? undefined : 'invisible'} />
                </div>
                <div className="mt-1 flex justify-center">
                  <WinRateBadge stats={partStats.get(part.id) ?? null} />
                </div>
                <p className={`mt-1 text-xs text-current/50 ${part.weightGrams ? '' : 'invisible'}`}>{part.weightGrams ?? 0} g</p>
              </Card>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* #144 — Turnier-Statistiken (Auto-Meta): eigener, beschrifteter Bereich, getrennt
          von den User-Bewertungen unten. Quelle sind ausschließlich gewertete Turnier-Matches
          (lib/meta), nie User-Eingaben. */}
      <section aria-labelledby="build-stats" className="space-y-3">
        <h2 id="build-stats" className="text-lg font-semibold">Turnier-Statistiken</h2>
        <Card className="flex flex-wrap items-center gap-3 p-4">
          <WinRateBadge stats={buildStats.get(id) ?? null} />
          <p className="text-xs text-current/50">
            Automatisch aus gewerteten Turnier-Matches — unabhängig von den User-Bewertungen.
          </p>
        </Card>
      </section>

      <section aria-labelledby="build-ratings" className="space-y-3">
        <h2 id="build-ratings" className="text-lg font-semibold">Bewertungen</h2>
        {viewerId ? (
          <Card>
            <RatingForm
              targetType="BUILD"
              targetId={id}
              existing={ownRating ? { ratingId: ownRating.id, stars: ownRating.stars, comment: ownRating.comment } : null}
            />
          </Card>
        ) : (
          <Card className="text-sm text-current/70">
            <Link href="/login" className="underline underline-offset-2">Melde dich an</Link>, um diesen Build zu bewerten.
          </Card>
        )}
        <RatingList
          targetType="BUILD"
          targetId={id}
          canModerate={canModerate}
          ratings={buildRatings.map((r) => ({
            id: r.id,
            stars: r.stars,
            comment: r.comment,
            createdAt: r.createdAt.toISOString(),
            username: r.user.username,
            own: r.user.id === viewerId,
          }))}
        />
      </section>

    </main>
  )
}
