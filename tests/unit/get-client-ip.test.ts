// tests/unit/get-client-ip.test.ts
// Regression test for https://github.com/KernicDE/beybladex/issues/34: the client-IP extraction
// used for IP-keyed rate limiters must not trust the leftmost (client-controlled) X-Forwarded-For
// entry — Traefik appends the real peer IP at the END, so a spoofed first hop must not change
// the extracted IP (previously each spoofed request got a fresh bucket = unlimited attempts).
import { describe, it, expect } from 'vitest'
import { getClientIp } from '@/lib/getClientIp'

function reqWith(headers: Record<string, string>) {
  return new Request('http://localhost/api/register', { headers })
}

describe('getClientIp (issue #34)', () => {
  it('uses the LAST X-Forwarded-For hop (Traefik-appended peer IP)', () => {
    expect(getClientIp(reqWith({ 'x-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7')
    expect(getClientIp(reqWith({ 'x-forwarded-for': '10.0.0.1, 198.51.100.9, 203.0.113.7' }))).toBe('203.0.113.7')
  })

  it('a spoofed leftmost XFF entry cannot change the extracted IP', () => {
    // Attacker sends a random first hop; Traefik appended the real peer at the end.
    const spoofed = reqWith({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' })
    expect(getClientIp(spoofed)).toBe('203.0.113.7')
    // Rotating the spoofed prefix must still land in the same rate-limit bucket.
    expect(getClientIp(reqWith({ 'x-forwarded-for': '9.9.9.9, 203.0.113.7' }))).toBe(
      getClientIp(reqWith({ 'x-forwarded-for': '8.8.8.8, 203.0.113.7' }))
    )
  })

  it('falls back to X-Real-IP when no X-Forwarded-For is present', () => {
    expect(getClientIp(reqWith({ 'x-real-ip': '192.0.2.33' }))).toBe('192.0.2.33')
  })

  it('prefers the last XFF hop over a (possibly spoofed) X-Real-IP', () => {
    expect(getClientIp(reqWith({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7', 'x-real-ip': '6.6.6.6' }))).toBe('203.0.113.7')
  })

  it('returns "unknown" when neither header is set', () => {
    expect(getClientIp(reqWith({}))).toBe('unknown')
  })
})
