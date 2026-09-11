// lib/callbackUrl.ts (RC8 issue #20)
// Post-login return target. The value arrives as a user-supplied ?callbackUrl= query
// parameter (login CTA links from the GuestGate on /decks and /collection), so it MUST
// be sanitized before use — an unvalidated redirect target is an open redirect. Only
// same-origin relative paths pass; everything else falls back to null (caller uses '/').
export function sanitizeCallbackUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  // '//host/path' would be treated as protocol-relative by the browser — reject explicitly.
  if (!raw.startsWith('/') || raw.startsWith('//')) return null
  return raw
}
