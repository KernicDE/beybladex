// app/profile/[username]/page.tsx
// Server component: loads the subject user, then projects it through resolveVisibleFields
// before rendering anything — the raw subject row must never reach the template/response.
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { resolveVisibleFields } from '@/lib/privacy'

export default async function ProfilePage({ params }: PageProps<'/profile/[username]'>) {
  const { username } = await params
  const session = await auth()
  const viewerId = session?.user?.id ?? null

  const subject = await prisma.user.findUnique({ where: { username } })
  if (!subject) {
    return <main className="p-6"><p>Profil nicht gefunden.</p></main>
  }

  // TODO(Phase 4): real Friendship lookup (Friendship.status === 'ACCEPTED' → isFriend = true;
  // BLOCKED additionally suppresses even PUBLIC fields). Phase 4 wires lib/friendship.ts in.
  const isFriend = false

  const view = resolveVisibleFields(subject, viewerId, isFriend)

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">{view.displayName ?? view.username}</h1>
      {view.bio && <p>{view.bio}</p>}
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
      {view.collectionVisible && <p>Sammlung ist sichtbar.</p>}
      {view.decksVisible && <p>Decks sind sichtbar.</p>}
      {viewerId === subject.id && <p>Das ist dein eigenes Profil.</p>}
    </main>
  )
}
