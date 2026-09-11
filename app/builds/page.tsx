// app/builds/page.tsx
// Build browse/search (Phase 5 Part A): cursor-paginated grid of BuildCards with a server-side
// part-name prefix search (?q=). Public and anonymous-readable (catalog surface) — explicitly
// revalidated rather than force-dynamic, per the Cross-Phase Regression Guard's caching rule.
// RC10 #28: the empty catalog explains the WHY and offers a role-dependent next step
// (admins: parts admin; visitors: living public surface) via lib/emptyStateActions.
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { searchBuilds, BUILD_PAGE_SIZE } from '@/lib/buildSearch'
import { getBuildStats } from '@/lib/metaCache'
import { catalogEmptyAction } from '@/lib/emptyStateActions'
import { BuildCard } from '@/components/beyblade/BuildCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'

export const revalidate = 60

export default async function BuildsPage({ searchParams }: PageProps<'/builds'>) {
  const { q, cursor } = await searchParams
  const query = typeof q === 'string' ? q.trim() : ''
  const { builds, nextCursor } = await searchBuilds({ q: query, cursor: typeof cursor === 'string' ? cursor : null })
  // Auto-Meta badges (Phase 5 Part D): ONE batch mget for the whole page, never per-card
  // round trips. Whole-cache-empty falls back to a direct DB computation inside getBuildStats.
  const winRates = await getBuildStats(builds.map((b) => b.id))
  // #28: role decides the empty-catalog CTA — admins can fix the emptiness, visitors can't.
  const session = await auth()
  const role = session?.user?.id
    ? (await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } }))?.role ?? null
    : null
  const cta = catalogEmptyAction(role)

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">Builds</h1>
      <p className="text-current/70">
        Kombinationen aus Blade, Ratchet und Bit. Suche nach einem Teilnamen, um Builds zu finden, die ihn verwenden.
      </p>

      <form role="search" action="/builds" className="flex items-center gap-2">
        <label htmlFor="builds-q" className="sr-only">Builds suchen</label>
        <Input id="builds-q" name="q" type="search" defaultValue={query} placeholder="Teilname, z. B. DranSword…" />
        <button type="submit" className="rounded-md bg-x-cyan px-4 py-2 text-sm font-medium text-base-dark transition-colors hover:bg-x-cyan/85">
          Suchen
        </button>
      </form>

      {builds.length === 0 ? (
        query ? (
          <EmptyState
            title="Keine Builds gefunden"
            description="Kein Build verwendet ein Teil mit diesem Namen."
            action={
              <Link href="/builds" className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium transition-colors hover:bg-current/5">
                Suche zurücksetzen
              </Link>
            }
          />
        ) : (
          <EmptyState
            title="Noch keine Builds im Katalog"
            description="Der Build-Katalog füllt sich, sobald Teile im Katalog sind."
            action={
              <Link
                href={cta.href}
                className="rounded-md bg-x-cyan px-4 py-2 text-sm font-medium text-base-dark transition-colors hover:bg-x-cyan/85"
              >
                {cta.label}
              </Link>
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
          Weitere Builds laden
        </Link>
      )}
      <p className="text-xs text-current/50">Seitengröße: {BUILD_PAGE_SIZE} Builds</p>
    </main>
  )
}
