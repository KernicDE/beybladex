// app/clubs/page.tsx
// Public club directory: paginated list with the shared SearchInput (?q= filters
// name/description — clubs have no visibility setting, discovery is open). EmptyState when
// none exist; "Neuer Club" CTA for logged-in users, an "Anmelden" prompt for guests (Task 13
// guest-state convention). Club creation itself lives at /clubs/new.
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { SearchInput } from '@/components/ui/SearchInput'

export const revalidate = 120 // public, infrequently-mutated content [REVIEW-FIX: performance P16]

const PAGE_SIZE = 24

export default async function ClubsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; cursor?: string }>
}) {
  const { q, cursor } = await searchParams
  const session = await auth()
  const query = (q ?? '').trim()

  const rows = await prisma.club.findMany({
    where: query
      ? { OR: [{ name: { contains: query, mode: 'insensitive' } }, { description: { contains: query, mode: 'insensitive' } }] }
      : {},
    orderBy: { name: 'asc' },
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    select: { id: true, name: true, slug: true, description: true, _count: { select: { members: true } } },
  })

  const hasMore = rows.length > PAGE_SIZE
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows
  const nextCursor = hasMore ? page[page.length - 1].id : null

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Clubs</h1>
        {session?.user ? (
          <Link
            href="/clubs/new"
            className="rounded-md bg-x-cyan px-4 py-2 text-sm font-medium text-base-dark transition-colors hover:bg-x-cyan/85"
          >
            Neuer Club
          </Link>
        ) : (
          <Link
            href="/login"
            className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium transition-colors hover:bg-current/5"
          >
            Anmelden, um zu gründen
          </Link>
        )}
      </div>

      <SearchInput action="/clubs" />

      {page.length === 0 ? (
        <EmptyState
          title={query ? 'Keine Clubs gefunden' : 'Noch keine Clubs'}
          description={
            query
              ? 'Für diese Suche gibt es aktuell keinen Club. Passe den Suchbegriff an.'
              : 'Sobald jemand einen Club gründet, erscheint er hier.'
          }
          action={
            session?.user ? (
              <Link
                href="/clubs/new"
                className="rounded-md bg-x-cyan px-4 py-2 text-sm font-medium text-base-dark transition-colors hover:bg-x-cyan/85"
              >
                Neuer Club
              </Link>
            ) : undefined
          }
        />
      ) : (
        <ul className="space-y-3">
          {page.map((club) => (
            <li key={club.id}>
              <Card className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/clubs/${club.slug}`} className="font-semibold hover:underline">
                    {club.name}
                  </Link>
                  <Badge tone="neutral">{club._count.members} {club._count.members === 1 ? 'Mitglied' : 'Mitglieder'}</Badge>
                </div>
                {club.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-current/60">{club.description}</p>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {nextCursor && (
        <div className="flex justify-center">
          <Link
            href={`/clubs?${query ? `q=${encodeURIComponent(query)}&` : ''}cursor=${nextCursor}`}
            className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium transition-colors hover:bg-current/5"
          >
            Weitere laden
          </Link>
        </div>
      )}
    </main>
  )
}
