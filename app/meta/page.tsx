// app/meta/page.tsx (Phase 5 Part D — Auto-Meta Engine)
// The "Meta" page: sortable Part/Build win-rate leaderboard, filterable by BeyType and
// manufacturer (query params, server-side filtering). Public and anonymous-readable — this is
// the differentiating "which Blade actually wins DACH tournaments" signal, so like the public
// events list ([REVIEW-FIX: performance P16]) it uses a short `revalidate = 60` instead of
// force-dynamic: the data behind it changes only when the periodic recompute refreshes the
// cache anyway, and 60s staleness on a leaderboard is imperceptible.
//
// DATA SOURCE: the Redis win-rate cache (meta:build:{id} / meta:part:{id}, batch-read with ONE
// mget — never N round trips) via lib/metaCache's getBuildStats/getPartStats, which fall back
// to a direct DB computation when the whole cache is empty (fresh deploy / Redis down), so
// the page never renders blank. Cached-but-below-threshold entries carry winRate: null and
// render "Noch nicht genug Daten".
//
// Row links: Build rows link to the combo page (/builds/[id]); Part rows link to the build
// browse filtered to builds using that part (parts have no detail page — same convention as
// the search page's Teile section).
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { getBuildStats, getPartStats } from '@/lib/metaCache'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { Select } from '@/components/ui/Select'
import { EmptyState } from '@/components/ui/EmptyState'
import { TypeBadge } from '@/components/beyblade/TypeBadge'
import { WinRateBadge } from '@/components/beyblade/WinRateBadge'

export const revalidate = 60

const BEY_TYPES = ['ATTACK', 'DEFENSE', 'STAMINA', 'BALANCE'] as const
const MANUFACTURERS = ['TT', 'HASBRO'] as const
const KINDS = ['builds', 'parts'] as const
const SORTS = ['winRate', 'appearances', 'name'] as const

const MANUFACTURER_LABEL: Record<string, string> = { TT: 'Takara Tomy', HASBRO: 'Hasbro' }

type Kind = (typeof KINDS)[number]
type Sort = (typeof SORTS)[number]

function oneOf<T extends string>(value: string | undefined, allowed: readonly T[]): T | null {
  return allowed.includes(value as T) ? (value as T) : null
}

function sortRows<T extends { name: string; appearances: number; winRate: number | null }>(
  rows: T[],
  sort: Sort,
  dir: 'asc' | 'desc',
): T[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    // Null win rates ("Noch nicht genug Daten") always sort LAST, regardless of direction —
    // a 100%-on-2-matches row at the top would be exactly the misleading small-sample signal
    // the MIN_APPEARANCES policy exists to suppress.
    if (sort === 'winRate') {
      if (a.winRate === null && b.winRate === null) return a.name.localeCompare(b.name)
      if (a.winRate === null) return 1
      if (b.winRate === null) return -1
      return sign * (a.winRate - b.winRate) || a.name.localeCompare(b.name)
    }
    if (sort === 'appearances') {
      return sign * (a.appearances - b.appearances) || a.name.localeCompare(b.name)
    }
    return sign * a.name.localeCompare(b.name)
  })
}

function filterParams(base: Record<string, string | undefined>): string {
  return new URLSearchParams(
    Object.entries(base).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString()
}

function SortHeader({ label, sortKey, currentSort, dir, base }: {
  label: string
  sortKey: Sort
  currentSort: Sort
  dir: 'asc' | 'desc'
  base: Record<string, string | undefined>
}) {
  const active = currentSort === sortKey
  const nextDir = active && dir === 'desc' ? 'asc' : 'desc'
  const qs = filterParams({ ...base, sort: sortKey, dir: nextDir })
  return (
    <Link
      href={`/meta?${qs}`}
      className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      {label}
      <span aria-hidden="true" className="text-current/50">{active ? (dir === 'asc' ? '↑' : '↓') : '↕'}</span>
    </Link>
  )
}

export default async function MetaPage({ searchParams }: PageProps<'/meta'>) {
  const params = await searchParams
  const kind: Kind = oneOf(typeof params.kind === 'string' ? params.kind : undefined, KINDS) ?? 'builds'
  const type = oneOf(typeof params.type === 'string' ? params.type : undefined, BEY_TYPES)
  const manufacturer = oneOf(typeof params.manufacturer === 'string' ? params.manufacturer : undefined, MANUFACTURERS)
  const sort: Sort = oneOf(typeof params.sort === 'string' ? params.sort : undefined, SORTS) ?? 'winRate'
  const dir = params.dir === 'asc' ? 'asc' : 'desc'
  const base = { kind, ...(type ? { type } : {}), ...(manufacturer ? { manufacturer } : {}) }

  let body: React.ReactNode
  if (kind === 'builds') {
    const builds = await prisma.build.findMany({
      where: {
        ...(type ? { type } : {}),
        // A build's parts come from one manufacturer in practice; the blade's manufacturer
        // stands in for the combo (ratchet/bit carry the same brand on real products).
        ...(manufacturer ? { blade: { is: { manufacturer } } } : {}),
      },
      select: {
        id: true,
        type: true,
        blade: { select: { id: true, name: true, beyType: true, manufacturer: true } },
        ratchet: { select: { name: true } },
        bit: { select: { name: true } },
      },
      orderBy: { id: 'asc' },
    })
    const stats = await getBuildStats(builds.map((b) => b.id))
    const rows = sortRows(
      builds.map((b) => ({
        id: b.id,
        name: `${b.blade.name} ${b.ratchet.name} ${b.bit.name}`,
        type: b.type,
        manufacturer: b.blade.manufacturer,
        appearances: stats.get(b.id)?.appearances ?? 0,
        winRate: stats.get(b.id)?.winRate ?? null,
      })),
      sort,
      dir,
    )
    body = rows.length === 0 ? (
      <EmptyState title="Keine Builds im Katalog" description="Sobald Builds im Katalog sind und Turnier-Matches ausgewertet wurden, erscheint hier die Win-Rate-Übersicht." />
    ) : (
      <ul className="divide-y rounded-xl border">
        {rows.map((row) => (
          <li key={row.id}>
            <Link href={`/builds/${row.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-current/5">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{row.name}</span>
                <span className="block text-sm text-current/60">{MANUFACTURER_LABEL[row.manufacturer]}</span>
              </span>
              <TypeBadge type={row.type} />
              <WinRateBadge stats={row} />
            </Link>
          </li>
        ))}
      </ul>
    )
  } else {
    const parts = await prisma.part.findMany({
      where: {
        ...(type ? { beyType: type } : {}),
        ...(manufacturer ? { manufacturer } : {}),
      },
      select: { id: true, name: true, category: true, beyType: true, manufacturer: true, dualSpin: true },
      orderBy: { name: 'asc' },
    })
    // Phase 16 item 3 — a dual-spin part gets TWO composite-keyed lookups (RIGHT/LEFT) instead
    // of one bare-id lookup, so the leaderboard never conflates its two modes into one
    // misleading combined number (the acceptance criterion's exact wording).
    const statKeys = parts.flatMap((p) => (p.dualSpin ? [`${p.id}:RIGHT`, `${p.id}:LEFT`] : [p.id]))
    const stats = await getPartStats(statKeys)
    const rows = sortRows(
      parts.flatMap((p) =>
        p.dualSpin
          ? (['RIGHT', 'LEFT'] as const).map((mode) => ({
              id: `${p.id}:${mode}`,
              name: `${p.name} (${mode === 'RIGHT' ? 'Rechtsdrehend' : 'Linksdrehend'})`,
              linkName: p.name,
              category: p.category,
              beyType: p.beyType,
              manufacturer: p.manufacturer,
              appearances: stats.get(`${p.id}:${mode}`)?.appearances ?? 0,
              winRate: stats.get(`${p.id}:${mode}`)?.winRate ?? null,
            }))
          : [
              {
                id: p.id,
                name: p.name,
                linkName: p.name,
                category: p.category,
                beyType: p.beyType,
                manufacturer: p.manufacturer,
                appearances: stats.get(p.id)?.appearances ?? 0,
                winRate: stats.get(p.id)?.winRate ?? null,
              },
            ]
      ),
      sort,
      dir,
    )
    body = rows.length === 0 ? (
      <EmptyState title="Keine Teile im Katalog" description="Dieser Filter trifft kein Teil im Katalog." />
    ) : (
      <ul className="divide-y rounded-xl border">
        {rows.map((row) => (
          <li key={row.id}>
            <Link href={`/builds?q=${encodeURIComponent(row.linkName)}`} className="flex items-center gap-3 px-4 py-3 hover:bg-current/5">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{row.name}</span>
                <span className="block text-sm text-current/60">
                  {row.category} · {MANUFACTURER_LABEL[row.manufacturer]}
                </span>
              </span>
              {row.beyType && <TypeBadge type={row.beyType} />}
              <WinRateBadge stats={row} />
            </Link>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">Meta</h1>
      <p className="text-current/70">
        Win-Rates aus ausgewerteten Turnier-Matches DACH-weit. Ein Teil oder Build braucht mindestens 10 ausgewertete
        Auftritte, bevor eine Win-Rate angezeigt wird — darunter steht „Noch nicht genug Daten“ statt einer
        irreführenden Klein-Stichprobe.
      </p>

      <Card className="space-y-3 p-4">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Ansicht">
          {KINDS.map((k) => (
            <Link
              key={k}
              role="tab"
              aria-selected={kind === k}
              href={`/meta?${filterParams({ ...base, kind: k, sort, dir })}`}
              className={`rounded-full px-3 py-1 text-sm font-medium ${kind === k ? 'bg-x-cyan text-base-dark' : 'bg-current/10 text-current/80 hover:bg-current/15'}`}
            >
              {k === 'builds' ? 'Builds' : 'Teile'}
            </Link>
          ))}
        </div>
        <form action="/meta" method="get" className="flex flex-wrap items-end gap-3">
          {Object.entries(base).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <input type="hidden" name="sort" value={sort} />
          <input type="hidden" name="dir" value={dir} />
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-current/60">Bey-Typ</span>
            <Select name="type" defaultValue={type ?? ''} className="w-auto">
              <option value="">Alle</option>
              {BEY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-current/60">Hersteller</span>
            <Select name="manufacturer" defaultValue={manufacturer ?? ''} className="w-auto">
              <option value="">Alle</option>
              {MANUFACTURERS.map((m) => <option key={m} value={m}>{MANUFACTURER_LABEL[m]}</option>)}
            </Select>
          </label>
          <button type="submit" className="rounded-md bg-x-cyan px-4 py-2 text-sm font-medium text-base-dark transition-colors hover:bg-x-cyan/85">
            Filtern
          </button>
        </form>
      </Card>

      <div className="flex items-center justify-between gap-2 text-sm">
        <div className="flex gap-4">
          <SortHeader label="Win-Rate" sortKey="winRate" currentSort={sort} dir={dir} base={base} />
          <SortHeader label="Auftritte" sortKey="appearances" currentSort={sort} dir={dir} base={base} />
          <SortHeader label="Name" sortKey="name" currentSort={sort} dir={dir} base={base} />
        </div>
        <Badge tone="cyan">{kind === 'builds' ? 'Builds' : 'Teile'}</Badge>
      </div>

      {body}
    </main>
  )
}
