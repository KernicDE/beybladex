// lib/urlValidation.ts
// Shared server-side validation for optional user-supplied URLs (club profile links).
// Hard https?-only allowlist: the value is rendered verbatim into <a href>, so anything
// else (javascript:, data:, vbscript:, protocol-relative //host, …) must be rejected
// even though it would pass a plain length/format check.
const ALLOWED_SCHEME = /^https?:\/\//i
const CONTROL_CHARS = /[\x00-\x1F\x7F]/

export function parseOptionalUrl(
  value: unknown,
  maxLength: number,
): { ok: boolean; value: string | null } {
  if (value === undefined || value === null) return { ok: true, value: null }
  if (typeof value !== 'string' || value.length > maxLength) return { ok: false, value: null }
  const trimmed = value.trim()
  if (!trimmed) return { ok: true, value: null }
  if (!ALLOWED_SCHEME.test(trimmed) || CONTROL_CHARS.test(trimmed)) return { ok: false, value: null }
  return { ok: true, value: trimmed }
}
