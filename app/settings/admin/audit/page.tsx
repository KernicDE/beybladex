// app/settings/admin/audit/page.tsx
// ADMIN-only, append-only AuditLog reader (Phase 4, [REVIEW-FIX: privacy-dsgvo #8]): every
// privileged mutation the plan registered (role changes, club-member kicks, account
// deletions) lands here, newest first, paginated take/cursor. Non-admins are redirected —
// the log names actors and targets and is not public.
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'

export const dynamic = 'force-dynamic' // per-user, privileged surface — never cached

const PAGE_SIZE = 50

function formatDateTime(date: Date): string {
  return date.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>
}) {
  const { cursor } = await searchParams
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const caller = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
  if (caller?.role !== 'ADMIN') redirect('/settings/profile')

  const rows = await prisma.auditLog.findMany({
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })

  // actorId is a plain string (the log must outlive user rows) — resolve display names in
  // one query for the whole page.
  const actorIds = [...new Set(rows.map((r) => r.actorId))]
  const actors = await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, username: true } })
  const actorName = new Map(actors.map((a) => [a.id, a.username]))

  const hasMore = rows.length > PAGE_SIZE
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows
  const nextCursor = hasMore ? page[page.length - 1].id : null

  return (
    <section aria-labelledby="admin-audit-heading" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id="admin-audit-heading" className="text-xl font-semibold">Administration — Audit-Log</h2>
        <Link
          href="/settings/admin"
          className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium transition-colors hover:bg-current/5"
        >
          Nutzer:innen
        </Link>
      </div>
      <p className="text-sm text-current/60">
        Append-only: Einträge werden nie geändert oder gelöscht.
      </p>

      {page.length === 0 ? (
        <EmptyState title="Noch keine Einträge" description="Sobald eine privilegierte Aktion ausgeführt wird, erscheint sie hier." />
      ) : (
        <ul className="space-y-3">
          {page.map((entry) => (
            <li key={entry.id}>
              <Card className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="cyan">{entry.action}</Badge>
                  <span className="text-sm text-current/60">
                    {formatDateTime(entry.createdAt)} · durch @{actorName.get(entry.actorId) ?? entry.actorId}
                  </span>
                </div>
                <p className="mt-1 text-sm">{entry.summary}</p>
                <p className="mt-1 text-xs text-current/40">
                  {entry.targetType}/{entry.targetId}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {nextCursor && (
        <div className="flex justify-center">
          <Link
            href={`/settings/admin/audit?cursor=${nextCursor}`}
            className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium transition-colors hover:bg-current/5"
          >
            Weitere laden
          </Link>
        </div>
      )}
    </section>
  )
}
