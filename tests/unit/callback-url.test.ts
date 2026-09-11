// tests/unit/callback-url.test.ts (RC8 issue #20)
// ?callbackUrl= is user-supplied input used as a post-login redirect target — only
// same-origin relative paths may pass, everything else must fall back to null.
import { describe, it, expect } from 'vitest'
import { sanitizeCallbackUrl } from '@/lib/callbackUrl'

describe('sanitizeCallbackUrl', () => {
  it('accepts same-origin relative paths', () => {
    expect(sanitizeCallbackUrl('/decks')).toBe('/decks')
    expect(sanitizeCallbackUrl('/collection')).toBe('/collection')
    expect(sanitizeCallbackUrl('/events/abc?tab=teilnehmer')).toBe('/events/abc?tab=teilnehmer')
  })

  it('rejects absolute URLs (open-redirect guard)', () => {
    expect(sanitizeCallbackUrl('https://evil.example.com')).toBeNull()
    expect(sanitizeCallbackUrl('http://evil.example.com/path')).toBeNull()
  })

  it('rejects protocol-relative URLs', () => {
    expect(sanitizeCallbackUrl('//evil.example.com')).toBeNull()
  })

  it('rejects empty and missing values', () => {
    expect(sanitizeCallbackUrl('')).toBeNull()
    expect(sanitizeCallbackUrl(null)).toBeNull()
    expect(sanitizeCallbackUrl(undefined)).toBeNull()
  })
})
