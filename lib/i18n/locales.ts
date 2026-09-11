// lib/i18n/locales.ts (RC14 #17)
// Locale registry and the PURE resolution/parsing half of the i18n layer — no next/ imports,
// no auth, no DB, so every rule here is unit-testable without seams (see tests/unit/i18n-*.test.ts).
//
// Issue #17 decisions, binding:
// - Locales are bare language codes (de, en), not region tags — the site is DACH-focused,
//   region variants buy nothing here and complicate the registry.
// - Adding a language = one entry in SUPPORTED_LOCALES + one messages/<locale>.json file.
//   Nothing else (no routing change, no schema change: User.language stores the bare code).

/** Cookie that carries a guest's explicit language choice (set by LanguageSwitcher). */
export const LOCALE_COOKIE = 'beybladex-locale'

/** Start set per #17 — the registry is deliberately open-ended. */
export const SUPPORTED_LOCALES = ['de', 'en'] as const

/** Flag emoji per locale (#125) — the switcher's compact current-language display. Unicode
 *  regional indicators, no icon font or image asset needed. */
export const LOCALE_FLAGS: Record<Locale, string> = {
  de: '🇩🇪',
  en: '🇬🇧',
}

/** The site's own language and fallback. NEVER resolved away from: an unknown/unsupported
 *  preference always degrades to German, the language every existing page is authored in. */
export const DEFAULT_LOCALE: Locale = 'de'

export type Locale = (typeof SUPPORTED_LOCALES)[number]

export function isSupportedLocale(value: string | undefined | null): value is Locale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

/** Accepts 'de', 'DE', 'de-AT', 'de_AT', ' de ' → 'de'; anything else → null. */
export function normalizeLocale(input: string | undefined | null): Locale | null {
  if (!input) return null
  const base = input.trim().toLowerCase().replace(/_/g, '-').split('-')[0]
  return isSupportedLocale(base) ? base : null
}

/** Parses an Accept-Language header (RFC 9110, e.g. 'de-AT,de;q=0.9,en;q=0.8') into the best
 *  supported base language, honoring q-values. Returns fallback for missing/unsupported input —
 *  this is the "system language determines the language if not logged in" rule from #17. */
export function resolveLocaleFromAcceptLanguage(
  header: string | null | undefined,
  fallback: Locale = DEFAULT_LOCALE,
): Locale {
  if (!header) return fallback
  const candidates = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';')
      const qParam = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
      const q = qParam ? Number(qParam.slice(2)) : 1
      return { locale: normalizeLocale(tag), q: Number.isNaN(q) ? 0 : q }
    })
    .filter((c) => c.locale !== null && c.q > 0)
    .sort((a, b) => b.q - a.q)
  return candidates[0]?.locale ?? fallback
}

/** Generic { locale → text } record (user-generated translations stored next to content).
 *  Returns the requested locale if present, otherwise the configured fallbackLocale, otherwise
 *  the first non-empty entry — UGC translation degrades gracefully, never to a blank. */
export function pickLocalized(
  record: Record<string, string> | null | undefined,
  locale: string,
  fallbackLocale: string = DEFAULT_LOCALE,
): string | null {
  if (!record) return null
  const wanted = record[locale]
  if (wanted && wanted.trim()) return wanted
  const fallback = record[fallbackLocale]
  if (fallback && fallback.trim()) return fallback
  for (const value of Object.values(record)) {
    if (value && value.trim()) return value
  }
  return null
}
