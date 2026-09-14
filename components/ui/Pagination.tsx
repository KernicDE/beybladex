// components/ui/Pagination.tsx (#155)
// Echte Seitenzahlen-Pagination (Link-basiert, server-rendered — passt zum GET-Formular-Muster
// der Listenseiten) statt "Weitere laden". Zeigt: ← [Seite] → [1] [2] [3] … [12], immer Seite 1
// und die letzte Seite, plus ein Fenster um die aktuelle Seite; Lücken als "…" (nicht klickbar).
// `buildHref` bekommt nur die Zielseite — der Aufrufer trägt Suchbegriff/Filter/Tab in die URL.
import Link from 'next/link'

const WINDOW = 1 // Seiten links/rechts der aktuellen, die immer sichtbar bleiben.

function pageNumbers(current: number, total: number): (number | 'ellipsis')[] {
  const pages = new Set<number>([1, total, current])
  for (let d = 1; d <= WINDOW; d++) {
    if (current - d >= 1) pages.add(current - d)
    if (current + d <= total) pages.add(current + d)
  }
  const sorted = [...pages].sort((a, b) => a - b)
  const withGaps: (number | 'ellipsis')[] = []
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i]! - sorted[i - 1]! > 1) withGaps.push('ellipsis')
    withGaps.push(sorted[i]!)
  }
  return withGaps
}

export function Pagination({
  page,
  totalPages,
  buildHref,
}: {
  page: number
  totalPages: number
  buildHref: (page: number) => string
}) {
  if (totalPages <= 1) return null
  const items = pageNumbers(page, totalPages)

  return (
    <nav aria-label="Seiten" className="flex flex-wrap items-center justify-center gap-1 text-sm">
      {page > 1 ? (
        <Link
          href={buildHref(page - 1)}
          aria-label="Vorherige Seite"
          className="flex h-8 min-w-8 items-center justify-center rounded-md border border-current/20 px-2 transition-colors hover:bg-current/5"
        >
          ←
        </Link>
      ) : (
        <span aria-hidden="true" className="flex h-8 min-w-8 items-center justify-center rounded-md border border-current/10 px-2 text-current/30">
          ←
        </span>
      )}

      {items.map((item, i) =>
        item === 'ellipsis' ? (
          <span key={`gap-${i}`} aria-hidden="true" className="flex h-8 min-w-8 items-center justify-center text-current/40">
            …
          </span>
        ) : item === page ? (
          <span key={item} aria-current="page" className="flex h-8 min-w-8 items-center justify-center rounded-md bg-x-cyan px-2 font-medium text-base-dark">
            {item}
          </span>
        ) : (
          <Link
            key={item}
            href={buildHref(item)}
            className="flex h-8 min-w-8 items-center justify-center rounded-md border border-current/20 px-2 transition-colors hover:bg-current/5"
          >
            {item}
          </Link>
        ),
      )}

      {page < totalPages ? (
        <Link
          href={buildHref(page + 1)}
          aria-label="Nächste Seite"
          className="flex h-8 min-w-8 items-center justify-center rounded-md border border-current/20 px-2 transition-colors hover:bg-current/5"
        >
          →
        </Link>
      ) : (
        <span aria-hidden="true" className="flex h-8 min-w-8 items-center justify-center rounded-md border border-current/10 px-2 text-current/30">
          →
        </span>
      )}
    </nav>
  )
}
