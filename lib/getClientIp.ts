// lib/getClientIp.ts
// Central, spoof-safe client-IP extraction for IP-keyed rate limiters (issue #34).
// NEVER use `x-forwarded-for.split(',')[0]`: that is the LEFTMOST, client-controlled entry —
// Traefik appends the genuine peer IP at the END of X-Forwarded-For but does not strip
// attacker-prefixed entries, so the leftmost hop is freely spoofable and was a rate-limit bypass.
export function getClientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    // The LAST hop is the one Traefik appended from the actual connection peer — the only
    // entry an HTTP client cannot forge. Earlier hops may be spoof chains, so ignore them.
    const hops = xff.split(',').map((h) => h.trim()).filter(Boolean)
    if (hops.length > 0) return hops[hops.length - 1]
  }
  // No X-Forwarded-For (direct hit / non-Traefik environment): X-Real-IP is set by the reverse
  // proxy from the connection peer. Only trusted as a fallback because Traefik always appends
  // to X-Forwarded-For in the real deployment, making the branch above authoritative there.
  const realIp = req.headers.get('x-real-ip')?.trim()
  if (realIp) return realIp
  return 'unknown'
}
