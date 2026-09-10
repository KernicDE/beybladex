// tests/unit/url-validation.test.ts
// Covers lib/urlValidation.parseOptionalUrl — the https?-only allowlist that guards
// club profile links (issue #47: stored XSS via javascript:/data: href).
import { describe, expect, it } from 'vitest'
import { parseOptionalUrl } from '@/lib/urlValidation'

const MAX = 200

describe('parseOptionalUrl', () => {
  it('accepts http and https URLs', () => {
    expect(parseOptionalUrl('https://example.com', MAX)).toEqual({ ok: true, value: 'https://example.com' })
    expect(parseOptionalUrl('http://example.com/path?q=1', MAX)).toEqual({ ok: true, value: 'http://example.com/path?q=1' })
  })

  it('accepts uppercase scheme/host', () => {
    expect(parseOptionalUrl('HTTPS://EXAMPLE.COM', MAX)).toEqual({ ok: true, value: 'HTTPS://EXAMPLE.COM' })
  })

  it('rejects javascript: URLs (any casing)', () => {
    expect(parseOptionalUrl('javascript:alert(1)', MAX).ok).toBe(false)
    expect(parseOptionalUrl('JaVaScRiPt:alert(1)', MAX).ok).toBe(false)
    expect(parseOptionalUrl('java\tscript:alert(1)', MAX).ok).toBe(false)
  })

  it('rejects data: URLs', () => {
    expect(parseOptionalUrl('data:text/html,<script>alert(1)</script>', MAX).ok).toBe(false)
  })

  it('rejects protocol-relative URLs', () => {
    expect(parseOptionalUrl('//evil.example/x', MAX).ok).toBe(false)
  })

  it('rejects other schemes', () => {
    expect(parseOptionalUrl('vbscript:msgbox(1)', MAX).ok).toBe(false)
    expect(parseOptionalUrl('ftp://example.com', MAX).ok).toBe(false)
    expect(parseOptionalUrl('mailto:a@b.c', MAX).ok).toBe(false)
  })

  it('rejects control characters inside an otherwise https URL', () => {
    expect(parseOptionalUrl('https://example.com\rbad', MAX).ok).toBe(false)
  })

  it('treats null/undefined/whitespace as absent', () => {
    expect(parseOptionalUrl(null, MAX)).toEqual({ ok: true, value: null })
    expect(parseOptionalUrl(undefined, MAX)).toEqual({ ok: true, value: null })
    expect(parseOptionalUrl('   ', MAX)).toEqual({ ok: true, value: null })
  })

  it('trims surrounding whitespace', () => {
    expect(parseOptionalUrl('  https://example.com  ', MAX)).toEqual({ ok: true, value: 'https://example.com' })
  })

  it('rejects non-strings and over-length values', () => {
    expect(parseOptionalUrl(42, MAX).ok).toBe(false)
    expect(parseOptionalUrl({}, MAX).ok).toBe(false)
    expect(parseOptionalUrl('https://example.com/' + 'a'.repeat(MAX), MAX).ok).toBe(false)
  })
})
