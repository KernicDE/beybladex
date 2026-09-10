// lib/tokenVersion.ts (issue #50)
// Session-revocation support for the 30-day JWTs: every security-relevant account change
// (GDPR erasure, TOTP deactivation, and — by contract — any future password-change route, which
// must call bumpTokenVersion) increments User.tokenVersion; lib/auth.ts stamps the current
// value into each new JWT as the `tv` claim and rejects any token whose claim no longer matches.
// The Redis cache exists purely to avoid a DB read per authenticated request; bumpTokenVersion
// DELETES (not overwrites) the key, so the cache can never drift ahead of the committed DB row.
import { prisma } from '@/lib/db'
import { redis } from '@/lib/redis'

const cacheKey = (userId: string) => `tv:${userId}`

export async function bumpTokenVersion(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { tokenVersion: { increment: 1 } } })
  await invalidateTokenVersionCache(userId)
}

export async function invalidateTokenVersionCache(userId: string): Promise<void> {
  await redis.del(cacheKey(userId)).catch(() => {})
}

// Current live version, or null when the user row no longer exists (which must invalidate the
// session — a token for a deleted/anonymized account is never valid).
export async function getTokenVersion(userId: string): Promise<number | null> {
  const cached = await redis.get(cacheKey(userId))
  if (cached !== null) return Number(cached)
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { tokenVersion: true } })
  if (!user) return null
  await redis.set(cacheKey(userId), String(user.tokenVersion)).catch(() => {})
  return user.tokenVersion
}
