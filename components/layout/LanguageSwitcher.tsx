// components/layout/LanguageSwitcher.tsx (RC14 #17, fixes #129, #125)
// Language switcher: the CURRENT locale shows as a flag icon (#125); hovering (or keyboard-
// focusing) the control opens a list of all supported locales, each with flag + native name.
// Choosing one writes the beybladex-locale cookie and refreshes the RSC payload, so the NEXT
// request resolves the new locale via lib/i18n/server.ts's cookie step. For signed-in users
// (issue #129) the profile setting User.language would win over the cookie and silently undo
// the switch — so the switcher additionally PATCHes the profile via the existing /api/profile
// endpoint (same call ProfileForm makes), making the control work for everyone.
'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { LOCALE_COOKIE, LOCALE_FLAGS, SUPPORTED_LOCALES, type Locale } from '@/lib/i18n/locales'

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

// Module-level so the React Compiler's immutability check doesn't flag the DOM write inside
// the component body. Plain, expiry-free guest preference; the server validates membership in
// SUPPORTED_LOCALES, an arbitrary cookie value is harmless.
function writeLocaleCookie(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`
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

  async function select(locale: Locale) {
    writeLocaleCookie(locale)
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

  // #125 — flag button + hover/focus dropdown instead of a text <select>. The list is CSS-
  // driven (group-hover/group-focus-within), so no open-state bookkeeping; a click/tap on the
  // button itself also toggles it via :focus, which the focus-within rule covers.
  return (
    <div className="group relative inline-block">
      <button
        type="button"
        aria-label={`${labels.label}: ${labels[current]}`}
        aria-haspopup="listbox"
        disabled={pending}
        className="rounded-md p-1.5 text-lg leading-none transition-colors hover:bg-current/5 focus-visible:outline-2 focus-visible:outline-x-cyan-text"
      >
        <span aria-hidden="true">{LOCALE_FLAGS[current]}</span>
      </button>
      <ul
        role="listbox"
        aria-label={labels.label}
        className="invisible absolute right-0 top-full z-50 mt-1 min-w-max rounded-md border border-current/15 bg-white p-1 shadow-lg group-focus-within:visible group-hover:visible dark:bg-base-dark-alt"
      >
        {SUPPORTED_LOCALES.map((locale) => (
          <li key={locale}>
            <button
              type="button"
              role="option"
              aria-selected={locale === current}
              onClick={() => select(locale)}
              className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm text-zinc-900 transition-colors hover:bg-current/5 dark:text-zinc-50"
            >
              <span aria-hidden="true">{LOCALE_FLAGS[locale]}</span>
              {labels[locale]}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
