// lib/i18n/server.ts (RC14 #17)
// The request-scoped half of the i18n layer: resolves the effective locale for the CURRENT
// request and returns the matching message dictionary. Server-only by construction (react cache
// + next/headers + auth) — client components receive dictionaries as plain props from a server
// component, per this codebase's prop-passing idiom (Session etc.).
//
// Resolution order (issue #17, binding):
//   1. signed-in user's profile setting (User.language)
//   2. the beybladex-locale cookie (guest's explicit choice via LanguageSwitcher)
//   3. the Accept-Language header (guest's system language)
//   4. DEFAULT_LOCALE (de) — the site degrades to German, never to a blank/broken UI.
import { cache } from 'react'
import { cookies, headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  isSupportedLocale,
  resolveLocaleFromAcceptLanguage,
  type Locale,
} from '@/lib/i18n/locales'
import deMessages from '@/lib/i18n/messages/de.json'
import enMessages from '@/lib/i18n/messages/en.json'

/** de.json is the canonical shape; every other locale must mirror its key set (enforced by
 *  tests/unit/i18n-messages.test.ts). */
export type Messages = typeof deMessages

const MESSAGES: Record<Locale, Messages> = {
  de: deMessages,
  // en.json mirrors de.json's key set by contract — the cast only bypasses TS's structural
  // complaint about differing literal types, not any runtime guarantee (the parity test owns that).
  en: enMessages as Messages,
}

/** Effective locale of the current request. Cached per request via react `cache` — the root
 *  layout's auth()/prisma work is not duplicated when a page also asks for the dictionary. */
export const getLocale = cache(async (): Promise<Locale> => {
  const session = await auth().catch(() => null)
  const userId = session?.user?.id
  if (userId) {
    // A cheap single-column read, same pattern as the root layout's avatar/unread queries.
    const language = (
      await prisma.user.findUnique({ where: { id: userId }, select: { language: true } })
    )?.language
    if (isSupportedLocale(language)) return language
  }

  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value
  if (isSupportedLocale(cookieLocale)) return cookieLocale

  const acceptLanguage = (await headers()).get('accept-language')
  return resolveLocaleFromAcceptLanguage(acceptLanguage, DEFAULT_LOCALE)
})

/** Message dictionary for the current request's locale. */
export const getDictionary = cache(async (): Promise<Messages> => MESSAGES[await getLocale()])
