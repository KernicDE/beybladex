// app/not-found.tsx (RC10 #30)
// Custom 404 — the generic Next.js dead end (hit e.g. at /tournaments without an id)
// becomes a branded, German offramp with links back to the working public surfaces.
// Rendered inside the root layout, so Header/Footer/MobileNav stay available.
import Link from 'next/link'
import { BrandMark } from '@/components/brand/BrandMark'

const OFFRAMP_CLS =
  'rounded-md px-4 py-2 text-sm font-medium transition-colors'

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center gap-4 p-4 py-16 text-center sm:p-6">
      <BrandMark size={48} />
      <h1 className="text-2xl font-semibold">Seite nicht gefunden</h1>
      <p className="text-current/70">
        Diese Seite existiert nicht (mehr). Der Link kann veraltet sein — oder die Seite wurde
        zwischenzeitlich verschoben.
      </p>
      <nav aria-label="Weitere Seiten" className="mt-2 flex flex-wrap justify-center gap-3">
        <Link
          href="/"
          className={`${OFFRAMP_CLS} bg-x-cyan text-base-dark hover:bg-x-cyan/85`}
        >
          Zur Startseite
        </Link>
        <Link
          href="/events"
          className={`${OFFRAMP_CLS} border border-current/30 hover:bg-current/5`}
        >
          Events entdecken
        </Link>
        <Link
          href="/search"
          className={`${OFFRAMP_CLS} border border-current/30 hover:bg-current/5`}
        >
          Suche
        </Link>
      </nav>
    </main>
  )
}
