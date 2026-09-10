// app/profile/[username]/page.tsx
// Server component: loads the subject user, then projects it through resolveVisibleFields
// before rendering anything — the raw subject row must never reach the template/response.
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { resolveVisibleFields } from '@/lib/privacy'
import { friendshipBetween, isFriendWith } from '@/lib/friendship'
import { FriendButton } from '@/components/social/FriendButton'
import { MarkdownContent } from '@/components/ui/MarkdownContent'

export const dynamic = 'force-dynamic'

export default async function ProfilePage({ params }: PageProps<'/profile/[username]'>) {
  const { username } = await params
  const session = await auth()
  const viewerId = session?.user?.id ?? null

  const subject = await prisma.user.findUnique({ where: { username } })
  if (!subject) {
    return <main className="p-6"><p>Profil nicht gefunden.</p></main>
  }

  // Phase 4: real Friendship lookup — isFriend is true ONLY for status === 'ACCEPTED' in
  // either direction (lib/friendship.ts semantics, fixed in Phase 1 Task 7). BLOCKED rows
  // resolve to isFriend = false and simply gate nothing extra here.
  const isFriend = viewerId ? await isFriendWith(viewerId, subject.id) : false

  // The FriendButton's initial state: the row between viewer and subject, if any.
  const existingFriendship = viewerId && viewerId !== subject.id
    ? await friendshipBetween(viewerId, subject.id)
    : null

  const view = resolveVisibleFields(subject, viewerId, isFriend)
  const isOwner = viewerId === subject.id

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">{view.displayName ?? view.username}</h1>
      {viewerId && !isOwner && (
        <FriendButton
          subjectId={subject.id}
          initial={{
            friendshipId: existingFriendship?.id ?? null,
            status: existingFriendship?.status ?? null,
            outgoing: existingFriendship?.requesterId === viewerId,
          }}
        />
      )}
      {view.bio && <MarkdownContent>{view.bio}</MarkdownContent>}
      <dl className="space-y-1">
        {view.city && (
          <div>
            <dt className="font-medium">Stadt</dt>
            <dd>{view.city}</dd>
          </div>
        )}
        {view.discordTag && (
          <div>
            <dt className="font-medium">Discord</dt>
            <dd>{view.discordTag}</dd>
          </div>
        )}
        {view.birthDate && (
          <div>
            <dt className="font-medium">Geburtsdatum</dt>
            <dd>{view.birthDate.toLocaleDateString('de-DE')}</dd>
          </div>
        )}
      </dl>
      {view.collectionVisible && (
        <p>
          <Link href={`/collection/${subject.username}`} className="underline underline-offset-2">
            Sammlung ansehen
          </Link>
        </p>
      )}
      {view.decksVisible && <p>Decks sind sichtbar.</p>}
      {isOwner && (
        <p>
          Das ist dein eigenes Profil.{' '}
          <Link href={`/profile/${subject.username}/friends`} className="underline underline-offset-2">
            Freunde anzeigen
          </Link>
        </p>
      )}
    </main>
  )
}
