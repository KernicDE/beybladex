// app/not-found.tsx (RC10 #30)
// Custom 404 — the generic Next.js dead end (hit e.g. at /tournaments without an id)
// becomes a branded, localized offramp (RC14 #17) with links back to the working public
// surfaces. Rendered inside the root layout, so Header/Footer/MobileNav stay available.
// Thin async wrapper: resolves the request dictionary and defers to the presentational
// components/not-found/NotFoundContent.tsx (kept separate so unit tests render it synchronously).
import { getDictionary } from '@/lib/i18n/server'
import { NotFoundContent } from '@/components/not-found/NotFoundContent'

export default async function NotFound() {
  const t = await getDictionary()
  return <NotFoundContent t={t} />
}
