// components/not-found/NotFoundContent.tsx (RC10 #30, RC14 #17)
// The custom 404's presentational half — a branded, localized offramp with links back to the
// working public surfaces. Pure props (the request dictionary), so it stays unit-testable;
// app/not-found.tsx is the thin async server wrapper resolving that dictionary.
import Link from 'next/link'
import { BrandMark } from '@/components/brand/BrandMark'
import type { Messages } from '@/lib/i18n/server'

const OFFRAMP_CLS =
  'rounded-md px-4 py-2 text-sm font-medium transition-colors'

export function NotFoundContent({ t }: { t: Messages }) {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center gap-4 p-4 py-16 text-center sm:p-6">
      <BrandMark size={48} />
      <h1 className="text-2xl font-semibold">{t.notFound.heading}</h1>
      <p className="text-current/70">
        {t.notFound.body}
      </p>
      <nav aria-label={t.nav.morePages} className="mt-2 flex flex-wrap justify-center gap-3">
        <Link
          href="/"
          className={`${OFFRAMP_CLS} bg-x-cyan text-base-dark hover:bg-x-cyan/85`}
        >
          {t.notFound.home}
        </Link>
        <Link
          href="/events"
          className={`${OFFRAMP_CLS} border border-current/30 hover:bg-current/5`}
        >
          {t.notFound.events}
        </Link>
        <Link
          href="/search"
          className={`${OFFRAMP_CLS} border border-current/30 hover:bg-current/5`}
        >
          {t.common.search}
        </Link>
      </nav>
    </main>
  )
}
