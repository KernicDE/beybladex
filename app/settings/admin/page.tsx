// app/settings/admin/page.tsx
// ADMIN-only user administration: paginated user list, searchable by username (?q=), with a
// role Select per row (GUEST/USER/TRUSTED/ADMIN — TRUSTED included like any other role: it
// means "trusted catalog contributor" for Phase 5's Part curation) plus Judge/Organizer
// checkboxes for the additive capabilities (issue #199 follow-up). Non-admins are redirected
// home — this page's API twin returns 403, so the redirect hides nothing.
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { SearchInput } from '@/components/ui/SearchInput'
import { RoleSelect } from '@/components/admin/RoleSelect'
import { DeleteUserButton } from '@/components/admin/DeleteUserButton'

export const dynamic = 'force-dynamic' // per-user, privileged surface — never cached

const PAGE_SIZE = 25

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cursor?: string; showErased?: string }>
}) {
  const { q, cursor, showErased } = await searchParams
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const caller = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
  if (caller?.role !== 'ADMIN') redirect('/settings/profile')
  const currentUserId = session.user.id

  const query = (q ?? '').trim()
  const includeErased = showErased === '1'
  // Issue #189 — ERASED rows are anonymized GDPR tombstones (lib/accountErasure.ts), hidden by
  // default so the list reflects real accounts; the toggle below lets an admin still audit them.
  const rows = await prisma.user.findMany({
    where: {
      ...(query ? { username: { contains: query, mode: 'insensitive' } } : {}),
      ...(includeErased ? {} : { status: { not: 'ERASED' } }),
    },
    orderBy: { username: 'asc' },
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, username: true, role: true, isJudge: true, isOrganizer: true, status: true, createdAt: true },
  })

  const hasMore = rows.length > PAGE_SIZE
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows
  const nextCursor = hasMore ? page[page.length - 1].id : null

  return (
    <section aria-labelledby="admin-users-heading" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id="admin-users-heading" className="text-xl font-semibold">Administration — Nutzer:innen</h2>
        <div className="flex gap-2">
          <Link
            href="/settings/admin/parts"
            className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium transition-colors hover:bg-current/5"
          >
            Teile-Katalog
          </Link>
          <Link
            href="/settings/admin/audit"
            className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium transition-colors hover:bg-current/5"
          >
            Audit-Log
          </Link>
          <Link
            href="/settings/admin/seasons"
            className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium transition-colors hover:bg-current/5"
          >
            Seasons
          </Link>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchInput action="/settings/admin" />
        <Link
          href={`/settings/admin?${query ? `q=${encodeURIComponent(query)}&` : ''}${includeErased ? '' : 'showErased=1'}`}
          className="whitespace-nowrap text-sm text-current/60 underline-offset-2 hover:underline"
        >
          {includeErased ? 'Gelöschte Konten ausblenden' : 'Gelöschte Konten anzeigen'}
        </Link>
      </div>

      {page.length === 0 ? (
        <EmptyState
          title="Keine Nutzer:innen gefunden"
          description="Für diese Suche gibt es keine Treffer. Passe den Suchbegriff an."
        />
      ) : (
        <ul className="space-y-3">
          {page.map((user) => (
            <li key={user.id}>
              <Card className="flex flex-wrap items-center gap-3 p-4">
                <span className="font-medium">@{user.username}</span>
                {user.role === 'ADMIN' && <Badge tone="cyan">Admin</Badge>}
                {user.status === 'ERASED' && <Badge tone="neutral">Gelöscht</Badge>}
                <span className="ml-auto flex items-center gap-2">
                  {user.status !== 'ERASED' && (
                    <>
                      <RoleSelect
                        userId={user.id}
                        currentRole={user.role}
                        currentIsJudge={user.isJudge}
                        currentIsOrganizer={user.isOrganizer}
                      />
                      {user.id !== currentUserId && (
                        <DeleteUserButton userId={user.id} username={user.username} />
                      )}
                    </>
                  )}
                </span>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {nextCursor && (
        <div className="flex justify-center">
          <Link
            href={`/settings/admin?${query ? `q=${encodeURIComponent(query)}&` : ''}${includeErased ? 'showErased=1&' : ''}cursor=${nextCursor}`}
            className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium transition-colors hover:bg-current/5"
          >
            Weitere laden
          </Link>
        </div>
      )}
    </section>
  )
}
