// tests/unit/i18n-messages.test.ts (RC14 #17)
// Dictionary contract: en.json must mirror de.json's key set exactly (Messages is typed FROM
// de.json, so a missing English key would render as undefined at runtime, not a type error on
// the cast in lib/i18n/server.ts), and no message may be blank — a blank is a silent hole in
// the UI. Adding a language = adding a file here plus one registry line in locales.ts.
import { describe, it, expect } from 'vitest'
import deMessages from '@/lib/i18n/messages/de.json'
import enMessages from '@/lib/i18n/messages/en.json'

/** Flattens a nested message tree into dotted leaf keys. */
function flatten(value: unknown, prefix = ''): string[] {
  if (typeof value === 'string') return [prefix]
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  )
}

const deKeys = flatten(deMessages).sort()
const enKeys = flatten(enMessages).sort()

describe('message dictionaries (de/en)', () => {
  it('en.json mirrors de.json’s full key set', () => {
    expect(enKeys).toEqual(deKeys)
  })

  it('has no blank messages in either locale', () => {
    // teaser.oClock is deliberately blank in en: German clock times take the "Uhr" suffix,
    // the English 12h format takes none (LandingEventTeaser guards the join).
    const BLANK_OK = new Set(['teaser.oClock'])
    for (const dict of [deMessages, enMessages]) {
      for (const key of deKeys) {
        if (BLANK_OK.has(key)) continue
        const value = key.split('.').reduce<unknown>((acc, part) => {
          if (typeof acc !== 'object' || acc === null) return undefined
          return (acc as Record<string, unknown>)[part]
        }, dict)
        expect(typeof value, `${key} must be a string`).toBe('string')
        expect((value as string).trim().length, `${key} must not be blank`).toBeGreaterThan(0)
      }
    }
  })

  it('covers every locale registry entry (adding a locale cannot forget its dictionary)', async () => {
    const { SUPPORTED_LOCALES } = await import('@/lib/i18n/locales')
    const dictionaries: Record<string, unknown> = { de: deMessages, en: enMessages }
    for (const locale of SUPPORTED_LOCALES) {
      expect(dictionaries[locale], `messages/${locale}.json must exist`).toBeDefined()
    }
  })

  it('keeps region labels for all DACH country codes', () => {
    for (const code of ['DE', 'AT', 'CH'] as const) {
      expect(deMessages.regions[code].length).toBeGreaterThan(0)
      expect(enMessages.regions[code].length).toBeGreaterThan(0)
    }
  })
})
