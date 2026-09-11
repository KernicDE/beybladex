// tests/unit/i18n-deepl.test.ts (RC14 #17)
// lib/i18n/deepl.ts: the optional DeepL integration for automatic UGC translation.
// The only untestable seam is the HTTP call — global fetch is stubbed; everything else
// (endpoint, auth header form, target-lang casing, null-on-any-failure contract) runs real.
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  isDeepLConfigured,
  toDeepLLang,
  translateUserContent,
  translateWithDeepL,
} from '@/lib/i18n/deepl'

const KEY_ENV = { DEEPL_API_KEY: 'test-key-123' }

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const spy = vi.fn(impl)
  vi.stubGlobal('fetch', spy)
  return spy
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isDeepLConfigured', () => {
  it('is false without a key and true with one (env injectable, no process.env coupling)', () => {
    expect(isDeepLConfigured({})).toBe(false)
    expect(isDeepLConfigured({ DEEPL_API_KEY: '' })).toBe(false)
    expect(isDeepLConfigured(KEY_ENV)).toBe(true)
  })
})

describe('toDeepLLang', () => {
  it('uppercases the bare locale codes DeepL expects', () => {
    expect(toDeepLLang('de')).toBe('DE')
    expect(toDeepLLang('en')).toBe('EN')
  })
})

describe('translateUserContent — the UGC contract', () => {
  it('returns null without configuration (show the original — #17’s accepted fallback)', async () => {
    const fetchSpy = stubFetch(async () => new Response('{}'))
    expect(await translateUserContent('Hallo Welt', 'en', {})).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns null for blank input without calling the API', async () => {
    const fetchSpy = stubFetch(async () => new Response('{}'))
    expect(await translateUserContent('   ', 'en', KEY_ENV)).toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('translateWithDeepL', () => {
  it('POSTs form-encoded to the free endpoint with the auth_key and uppercased target_lang', async () => {
    const fetchSpy = stubFetch(async (url, init) => {
      expect(url).toBe('https://api-free.deepl.com/v2/translate')
      expect(init.method).toBe('POST')
      const body = new URLSearchParams(init.body as string)
      expect(body.get('auth_key')).toBe('test-key-123')
      expect(body.get('text')).toBe('Hallo Welt')
      expect(body.get('target_lang')).toBe('EN')
      return Response.json({
        translations: [{ detected_source_language: 'DE', text: 'Hello world' }],
      })
    })
    const result = await translateWithDeepL('Hallo Welt', 'en', KEY_ENV)
    expect(result).toEqual({ text: 'Hello world', detectedSourceLang: 'DE' })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('returns null on a non-2xx response', async () => {
    stubFetch(async () => new Response('boom', { status: 403 }))
    expect(await translateWithDeepL('Hallo', 'en', KEY_ENV)).toBeNull()
  })

  it('returns null on a malformed body (missing translations)', async () => {
    stubFetch(async () => Response.json({}))
    expect(await translateWithDeepL('Hallo', 'en', KEY_ENV)).toBeNull()
  })

  it('returns null when the network rejects', async () => {
    stubFetch(async () => {
      throw new TypeError('fetch failed')
    })
    expect(await translateWithDeepL('Hallo', 'en', KEY_ENV)).toBeNull()
  })

  it('returns null without a key even if fetch would succeed', async () => {
    stubFetch(async () =>
      Response.json({ translations: [{ text: 'nope' }] }),
    )
    expect(await translateWithDeepL('Hallo', 'en', {})).toBeNull()
  })
})
