// app/profile/[username]/friends/page.tsx (Phase 4)
// The profile owner's ACCEPTED friends list.
//
// Access decision (documented): there is no `friendsVisibility` field in the spec's privacy
// model, and a friends list exposes third parties' data (who is friends with whom), so the
// conservative gate is: ONLY the profile owner can view this route. Accepted friends of the
// owner can still see the individual profiles they have access to — just not the aggregated
// list. Anonymous and other users get a plain "nicht verfügbar" — no existence leak.
// Pagination: take + id cursor (standing rule), even though real friend lists are small.
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { EmptyState } from '@/components/ui/EmptyState'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 50

export default async function FriendsPage({ params, searchParams }: PageProps<'/profile/[username]/friends'>) {
  const { username } = await params
  const { cursor } = await searchParams
  const session = await auth()
  const viewerId = session?.user?.id ?? null

  const subject = await prisma.user.findUnique({ where: { username }, select: { id: true, username: true } })
  if (!subject || viewerId !== subject.id) {
    return <main className="p-6"><p>Diese Freundesliste ist nicht verfügbar.</p></main>
  }

  const rows = await prisma.friendship.findMany({
    where: {
      status: 'ACCEPTED',
      OR: [{ requesterId: subject.id }, { addresseeId: subject.id }],
    },
    orderBy: [{ id: 'asc' }],
    take: PAGE_SIZE + 1,
    ...(typeof cursor === 'string' && cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      requester: { select: { username: true, displayName: true } },
      addressee: { select: { username: true, displayName: true } },
    },
  })
  const hasMore = rows.length > PAGE_SIZE
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">Freunde von @{subject.username}</h1>
      {page.length === 0 ? (
        <EmptyState
          title="Noch keine Freunde"
          description="Freundschaften entstehen über „Anfrage senden“ auf dem Profil eines anderen Nutzers."
        />
      ) : (
        <ul className="divide-y rounded-xl border">
          {page.map((row) => {
            const friend = row.requesterId === subject.id ? row.addressee : row.requester
            return (
              <li key={row.id}>
                <Link
                  href={`/profile/${friend.username}`}
                  className="block px-4 py-3 hover:bg-current/5"
                >
                  {friend.displayName ?? friend.username}
                  <span className="ml-2 text-sm text-current/60">@{friend.username}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
      {hasMore && page.length > 0 && (
        <Link
          href={`/profile/${subject.username}/friends?cursor=${page[page.length - 1].id}`}
          className="inline-block underline underline-offset-2"
        >
          Weitere laden
        </Link>
      )}
    </main>
  )
}
