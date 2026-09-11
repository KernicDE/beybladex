// lib/i18n/deepl.ts (RC14 #17)
// Optional DeepL integration for automatic translation of user-generated content (#17's last
// acceptance criterion: "translated automatically (DeepL free API) or not translated").
// Follows the repo's degrade-gracefully convention (lib/mailer.ts's SMTP_HOST, lib/webPush.ts's
// VAPID keys): with DEEPL_API_KEY unset, isDeepLConfigured() is false and translateUserContent
// returns null — callers then show the original text, which is ALWAYS acceptable per #17.
//
// Free API endpoint per DeepL docs (api-free.deepl.com), auth via the `Authorization:
// DeepL-Auth-Key <key>` header. [FIX 2026-09-11] DeepL has retired the older `auth_key` form
// field — a real key against the current API gets a 403 "Missing Authorization header" with
// that approach, so translateWithDeepL silently returned null on EVERY call despite being fully
// configured. Found while translating messages/en.json for real with a live key.
// The network half is the ONLY untestable seam here and is deliberately a tiny fetch wrapper,
// so unit tests stub global fetch and exercise everything else for real.
import type { Locale } from '@/lib/i18n/locales'

const DEEPL_FREE_ENDPOINT = 'https://api-free.deepl.com/v2/translate'

interface DeepLTranslation {
  detected_source_language?: string
  text: string
}

export interface TranslatedContent {
  text: string
  /** Source language DeepL detected (uppercase, e.g. 'DE') — null when unknown. */
  detectedSourceLang: string | null
}

/** DeepL expects uppercase target language codes; the locale registry is lowercase bare codes. */
export function toDeepLLang(locale: Locale): string {
  return locale.toUpperCase()
}

export function isDeepLConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.DEEPL_API_KEY)
}

/** Single translation call. Returns null on ANY failure (network, non-2xx, malformed body) —
 * automatic translation is a convenience, never a hard dependency of a request. */
export async function translateWithDeepL(
  text: string,
  targetLocale: Locale,
  env: Record<string, string | undefined> = process.env,
): Promise<TranslatedContent | null> {
  const authKey = env.DEEPL_API_KEY
  if (!authKey || !text.trim()) return null
  try {
    const res = await fetch(DEEPL_FREE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `DeepL-Auth-Key ${authKey}`,
      },
      body: new URLSearchParams({
        text,
        target_lang: toDeepLLang(targetLocale),
      }),
      // UGC translation is best-effort context, never worth a slow tail on a user request.
      signal: AbortSignal.timeout(8000),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { translations?: DeepLTranslation[] }
    const first = body?.translations?.[0]
    if (!first || typeof first.text !== 'string' || !first.text) return null
    return {
      text: first.text,
      detectedSourceLang: first.detected_source_language ?? null,
    }
  } catch {
    return null
  }
}

/** The contract UGC call sites use: translate into `locale`, or null (= show the original).
 *  Passing the source locale through lets callers skip the API round trip when the content is
 *  already in the requested language. */
export async function translateUserContent(
  text: string,
  locale: Locale,
  env: Record<string, string | undefined> = process.env,
): Promise<TranslatedContent | null> {
  if (!isDeepLConfigured(env)) return null
  return translateWithDeepL(text, locale, env)
}
