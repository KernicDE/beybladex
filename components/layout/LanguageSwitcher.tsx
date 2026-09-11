// components/layout/LanguageSwitcher.tsx (RC14 #17, fix #129)
// Language switcher: writes the beybladex-locale cookie and refreshes the RSC payload, so the
// NEXT request resolves the new locale via lib/i18n/server.ts's cookie step. For signed-in
// users (issue #129) the profile setting User.language would win over the cookie and silently
// undo the switch — so the switcher additionally PATCHes the profile via the existing
// /api/profile endpoint (same call ProfileForm makes), making the control work for everyone.
'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Languages } from 'lucide-react'
import { LOCALE_COOKIE, SUPPORTED_LOCALES, type Locale } from '@/lib/i18n/locales'

// useRouter throws outside an App Router context (e.g. unit tests) — fall back to a full
// reload in that case. Same pattern as components/ui/SearchInput.tsx's useRouterSafe; always
// called, so hook order stays stable.
function useRouterSafe() {
  try {
    return useRouter()
  } catch {
    return null
  }
}

export function LanguageSwitcher({
  current,
  labels,
  authed = false,
}: {
  current: Locale
  /** Display name per locale (t.language.<locale>) + the control's accessible label. */
  labels: Record<Locale, string> & { label: string }
  /** Whether the viewer is signed in. When true, the choice is also written to User.language
   *  (#129) — otherwise the profile setting would override the cookie on the next request and
   *  the switcher would appear broken. */
  authed?: boolean
}) {
  const router = useRouterSafe()
  const [pending, startTransition] = useTransition()

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const locale = e.target.value as Locale
    // Plain, expiry-free guest preference; the server validates membership in
    // SUPPORTED_LOCALES, an arbitrary cookie value is harmless.
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`
    if (authed) {
      // Best-effort: a failed write leaves the cookie in place, which still applies to the
      // signed-OUT case — never block the refresh on the network.
      await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: locale }),
      }).catch(() => {})
    }
    if (router) startTransition(() => router.refresh())
    else window.location.reload()
  }

  return (
    <label className="inline-flex items-center gap-1.5 text-sm text-current/80">
      <Languages size={15} aria-hidden="true" className="text-current/60" />
      <span className="sr-only">{labels[current]}</span>
      <select
        aria-label={labels.label}
        value={current}
        disabled={pending}
        onChange={onChange}
        className="rounded-md border border-current/20 bg-transparent px-1.5 py-1 text-sm text-current focus-visible:outline-2 focus-visible:outline-x-cyan-text"
      >
        {SUPPORTED_LOCALES.map((locale) => (
          <option key={locale} value={locale} className="bg-white text-zinc-900 dark:bg-base-dark-alt dark:text-zinc-50">
            {labels[locale]}
          </option>
        ))}
      </select>
    </label>
  )
}
