// app/builds/[id]/page.tsx
// Build detail (Phase 5 Part A): the combo page spec §2.A promises — parts with images,
// TypeBadge, and the rating/comment area below (list + form). The rating section is
// per-user/live, so this page is force-dynamic per the caching half of the Regression Guard.
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { RatingForm } from '@/components/beyblade/RatingForm'
import { RatingList } from '@/components/beyblade/RatingList'
import { TypeBadge } from '@/components/beyblade/TypeBadge'
import { WinRateBadge } from '@/components/beyblade/WinRateBadge'
import { getBuildStats, getPartStats } from '@/lib/metaCache'

export const dynamic = 'force-dynamic'

const RATING_PAGE_SIZE = 20

export default async function BuildDetailPage({ params }: PageProps<'/builds/[id]'>) {
  const { id } = await params
  const session = await auth()
  const viewerId = session?.user?.id ?? null

  const build = await prisma.build.findUnique({
    where: { id },
    include: {
      blade: true,
      ratchet: true,
      bit: true,
      ratings: {
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: RATING_PAGE_SIZE,
        include: { user: { select: { id: true, username: true } } },
      },
    },
  })
  if (!build) notFound()

  let canModerate = false
  let viewerUsername: string | null = null
  if (viewerId) {
    const caller = await prisma.user.findUnique({ where: { id: viewerId }, select: { role: true, username: true } })
    canModerate = caller?.role === 'TRUSTED' || caller?.role === 'ADMIN'
    viewerUsername = caller?.username ?? null
  }

  const aggregate = await prisma.rating.aggregate({ where: { buildId: id }, _avg: { stars: true }, _count: true })
  const ownRating = viewerUsername ? build.ratings.find((r) => r.user.id === viewerId) : undefined

  // Auto-Meta win rates (Phase 5 Part D) — batch cache reads (single-key for the build,
  // one mget for its three parts), with direct-compute fallback on an empty cache.
  const [buildStats, partStats] = await Promise.all([
    getBuildStats([id]),
    getPartStats([build.bladeId, build.ratchetId, build.bitId]),
  ])

  const parts = [
    { label: 'Blade', part: build.blade },
    { label: 'Ratchet', part: build.ratchet },
    { label: 'Bit', part: build.bit },
  ] as const

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <Link href="/builds" className="text-sm text-current/60 underline underline-offset-2">← Alle Builds</Link>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            {/* [Fix while adding productCode] title always rendered the blade name, never the
                curated Set name (e.g. "Sword Dran 3-60F") — same fallback BuildCard already uses. */}
            <h1 className="text-2xl font-semibold">
              {build.name ?? build.blade.name}
              {build.productCode && <span className="ml-2 text-base font-normal text-current/50">{build.productCode}</span>}
            </h1>
            <p className="text-current/60">{build.blade.name} · {build.ratchet.name} · {build.bit.name}</p>
          </div>
          <TypeBadge type={build.type} />
        </div>
        {aggregate._count > 0 && (
          <p className="mt-2 text-sm text-current/60">
            Ø {aggregate._avg.stars!.toFixed(1)} Sterne aus {aggregate._count} Bewertung{aggregate._count === 1 ? '' : 'en'}
          </p>
        )}
        <div className="mt-2">
          <WinRateBadge stats={buildStats.get(id) ?? null} />
        </div>
      </Card>

      <section aria-labelledby="build-parts" className="space-y-3">
        <h2 id="build-parts" className="text-lg font-semibold">Teile</h2>
        <ul className="grid gap-3 sm:grid-cols-3">
          {parts.map(({ label, part }) => (
            <li key={part.id}>
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
                <p className="mt-2 font-medium">{part.name}</p>
                <p className="text-sm text-current/60">{label}</p>
                <div className="mt-1 flex justify-center gap-1">
                  <Badge tone="cyan">{part.category}</Badge>
                  {part.beyType && <TypeBadge type={part.beyType} />}
                </div>
                <div className="mt-1 flex justify-center">
                  <WinRateBadge stats={partStats.get(part.id) ?? null} />
                </div>
                {part.weightGrams && <p className="mt-1 text-xs text-current/50">{part.weightGrams} g</p>}
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="build-ratings" className="space-y-3">
        <h2 id="build-ratings" className="text-lg font-semibold">Bewertungen</h2>
        {viewerId ? (
          <Card>
            <RatingForm
              buildId={id}
              existing={ownRating ? { ratingId: ownRating.id, stars: ownRating.stars, comment: ownRating.comment } : null}
            />
          </Card>
        ) : (
          <Card className="text-sm text-current/70">
            <Link href="/login" className="underline underline-offset-2">Melde dich an</Link>, um diesen Build zu bewerten.
          </Card>
        )}
        <RatingList
          buildId={id}
          canModerate={canModerate}
          ratings={build.ratings.map((r) => ({
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
