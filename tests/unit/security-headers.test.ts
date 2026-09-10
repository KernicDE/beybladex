// tests/unit/security-headers.test.ts
// Regression guard for https://github.com/KernicDE/beybladex/issues/45: next.config.ts must set
// a Content-Security-Policy plus the core security headers on every route. (Whether they
// actually arrive in production is verified manually via curl -I / DevTools after deploy.)
import { describe, it, expect } from 'vitest'
import nextConfig from '@/next.config'

describe('security headers (issue #45)', () => {
  it('sets CSP, nosniff, HSTS and Referrer-Policy on all routes', async () => {
    const headers = await nextConfig.headers!()
    expect(headers).toHaveLength(1)
    expect(headers[0].source).toBe('/:path*')
    const map = Object.fromEntries(headers[0].headers.map((h) => [h.key, h.value]))

    expect(map['X-Content-Type-Options']).toBe('nosniff')
    expect(map['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
    expect(map['Strict-Transport-Security']).toContain('max-age=31536000')

    const csp = map['Content-Security-Policy']
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("frame-ancestors 'none'")
    // App is fully self-hosted (vendored fonts/Leaflet, same-origin map tiles) — no external
    // origins anywhere in the policy.
    expect(csp).not.toMatch(/https?:\/\//)
    // Production must not need unsafe-eval (React dev error stacks only).
    if (process.env.NODE_ENV !== 'development') expect(csp).not.toContain("'unsafe-eval'")
  })
})
