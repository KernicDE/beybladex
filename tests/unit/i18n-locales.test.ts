// tests/unit/i18n-locales.test.ts (RC14 #17)
// Pure half of the i18n layer (lib/i18n/locales.ts): locale registry rules, Accept-Language
// parsing (the "system language for guests" rule) and pickLocalized's graceful degradation.
// No next/ imports — everything here runs for real, no seams.
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  SUPPORTED_LOCALES,
  isSupportedLocale,
  normalizeLocale,
  resolveLocaleFromAcceptLanguage,
  pickLocalized,
} from '@/lib/i18n/locales'

describe('locale registry', () => {
  it('starts with de and en and defaults to de', () => {
    expect(SUPPORTED_LOCALES).toContain('de')
    expect(SUPPORTED_LOCALES).toContain('en')
    expect(DEFAULT_LOCALE).toBe('de')
  })

  it('LOCALE_COOKIE is namespaced and stable (it is a persisted guest preference)', () => {
    expect(LOCALE_COOKIE).toBe('beybladex-locale')
  })

  it('isSupportedLocale accepts only registered codes', () => {
    expect(isSupportedLocale('de')).toBe(true)
    expect(isSupportedLocale('en')).toBe(true)
    expect(isSupportedLocale('fr')).toBe(false)
    expect(isSupportedLocale('')).toBe(false)
    expect(isSupportedLocale(undefined)).toBe(false)
    expect(isSupportedLocale(null)).toBe(false)
  })
})

describe('normalizeLocale', () => {
  it('accepts bare codes, case-insensitively', () => {
    expect(normalizeLocale('de')).toBe('de')
    expect(normalizeLocale('EN')).toBe('en')
  })

  it('reduces region variants and underscore tags to the base language', () => {
    expect(normalizeLocale('de-AT')).toBe('de')
    expect(normalizeLocale('de_AT')).toBe('de')
    expect(normalizeLocale(' en-US ')).toBe('en')
  })

  it('rejects unsupported and empty input with null', () => {
    expect(normalizeLocale('fr')).toBeNull()
    expect(normalizeLocale('')).toBeNull()
    expect(normalizeLocale(undefined)).toBeNull()
    expect(normalizeLocale(null)).toBeNull()
  })
})

describe('resolveLocaleFromAcceptLanguage — the guest rule (#17)', () => {
  it('falls back to de without a header', () => {
    expect(resolveLocaleFromAcceptLanguage(null)).toBe('de')
    expect(resolveLocaleFromAcceptLanguage(undefined)).toBe('de')
    expect(resolveLocaleFromAcceptLanguage('')).toBe('de')
  })

  it('picks the highest-q supported language', () => {
    expect(resolveLocaleFromAcceptLanguage('de-AT,de;q=0.9,en;q=0.8')).toBe('de')
    expect(resolveLocaleFromAcceptLanguage('en-US,en;q=0.9,de;q=0.8')).toBe('en')
    expect(resolveLocaleFromAcceptLanguage('fr-FR,fr;q=0.9,en;q=0.7')).toBe('en')
  })

  it('honors q-ordering over header order', () => {
    expect(resolveLocaleFromAcceptLanguage('de;q=0.5,en;q=0.9')).toBe('en')
  })

  it('skips q=0 (explicitly refused) languages', () => {
    expect(resolveLocaleFromAcceptLanguage('de;q=0,en;q=0.5')).toBe('en')
  })

  it('degrades to de when nothing is supported', () => {
    expect(resolveLocaleFromAcceptLanguage('fr,es')).toBe('de')
  })

  it('ignores malformed q-values instead of NaN-sorting them to the top', () => {
    expect(resolveLocaleFromAcceptLanguage('en;q=bogus,de')).toBe('de')
  })
})

describe('pickLocalized — UGC translation records', () => {
  const record = { de: 'Hallo', en: 'Hello' }

  it('returns the requested locale when present and non-empty', () => {
    expect(pickLocalized(record, 'en')).toBe('Hello')
    expect(pickLocalized(record, 'de')).toBe('Hallo')
  })

  it('falls back to the fallback locale, then to any non-empty entry', () => {
    expect(pickLocalized(record, 'fr')).toBe('Hallo') // fallbackLocale default 'de'
    expect(pickLocalized({ fr: 'Bonjour' }, 'en', 'fr')).toBe('Bonjour') // fallback itself
    expect(pickLocalized({ en: '', de: 'Hallo' }, 'en')).toBe('Hallo') // empty wanted string skipped
  })

  it('returns null for empty/missing records, never a blank', () => {
    expect(pickLocalized(null, 'de')).toBeNull()
    expect(pickLocalized(undefined, 'de')).toBeNull()
    expect(pickLocalized({}, 'de')).toBeNull()
    expect(pickLocalized({ de: '   ' }, 'de')).toBeNull()
  })
})
