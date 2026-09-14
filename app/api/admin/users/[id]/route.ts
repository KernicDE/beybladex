// app/api/admin/users/[id]/route.ts (issue #185)
// DELETE — ADMIN-only user erasure. Reuses the exact same Art. 17 erasure/anonymization
// matrix as self-service account deletion (lib/accountErasure.ts) — an admin-triggered
// deletion is not a special "hard delete", just a different actor invoking the same erasure,
// so every model that erasure already covers (decks, club membership, tournament history,
// audit trail, avatar file, session invalidation via tokenVersion) is covered here for free.
// Self-deletion through this endpoint is refused (400) — an admin removing their own account
// is the self-service /api/account DELETE flow (password/TOTP re-confirmation), not a
// same-click admin action; this endpoint is for removing OTHER accounts (spam, abuse, GDPR
// requests filed by support).
import { requireAdmin } from '@/lib/guards'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { eraseOrAnonymizeUser } from '@/lib/accountErasure'

type Ctx = { params: Promise<{ id: string }> }

export async function DELETE(_req: Request, { params }: Ctx) {
  const gate = await requireAdmin()
  if ('error' in gate) return gate.error

  const { id } = await params
  if (id === gate.userId) {
    return Response.json({ error: 'cannot_delete_self' }, { status: 400 })
  }

  // Deletion is irreversible — same tight per-actor rate limit as self-service deletion.
  const { allowed } = await rateLimit(`admin-user-delete:${gate.userId}`, 5, 3600)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true } })
  if (!target) return Response.json({ error: 'not_found' }, { status: 404 })

  await eraseOrAnonymizeUser(target.id, gate.userId)

  return new Response(null, { status: 204 })
}
