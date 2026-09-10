// app/profile/[username]/page.tsx (Phase 10 item 4 — rebuilt)
// Server component: loads the subject user, then projects it through resolveVisibleFields
// before rendering anything — the raw subject row must never reach the template/response.
// Uses components/ui/* primitives (standing Cross-Phase Regression Guard rule — the old
// version was raw unstyled <p>/<dl> markup). Adds: an avatar placeholder, a real link for
// decksVisible (was dead-end text with no link, unlike collectionVisible right above it),
// tournament participation history, and club memberships — both gated behind
// profileVisible, the same lever every other extra-content field on this page already uses
// (there is no dedicated privacy field for either, and neither existed before this phase).
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { resolveVisibleFields } from '@/lib/privacy'
import { friendshipBetween, isFriendWith } from '@/lib/friendship'
import { FriendButton } from '@/components/social/FriendButton'
import { MarkdownContent } from '@/components/ui/MarkdownContent'
import { Badge } from '@/components/ui/Badge'
import { Card, CardTitle } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'

export const dynamic = 'force-dynamic'

function formatDate(date: Date): string {
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default async function ProfilePage({ params }: PageProps<'/profile/[username]'>) {
  const { username } = await params
  const session = await auth()
  const viewerId = session?.user?.id ?? null

  const subject = await prisma.user.findUnique({ where: { username } })
  if (!subject) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
        <EmptyState title="Profil nicht gefunden" description="Dieser Benutzername existiert nicht." />
      </main>
    )
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
  const profileVisible = view.displayName !== null || isOwner // profileVisible isn't returned directly; displayName tracks it 1:1 except for the isOwner-always-true case already folded in.

  const [tournamentHistory, clubMemberships] = profileVisible
    ? await Promise.all([
        prisma.tournamentParticipant.findMany({
          where: { userId: subject.id, withdrawn: false },
          orderBy: { id: 'desc' },
          take: 10,
          select: { tournament: { select: { id: true, title: true, startDate: true } } },
        }),
        prisma.clubMember.findMany({
          where: { userId: subject.id, status: 'ACTIVE' },
          orderBy: { id: 'asc' },
          take: 20,
          select: { club: { select: { slug: true, name: true } } },
        }),
      ])
    : [[], []]

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-4">
        {/* Avatar placeholder (Phase 10 item 4) — no avatar-upload feature exists yet
            (deliberately out of scope, see Phase 5 Part A's own note); a static initial
            keeps the header from looking broken until that lands. */}
        <div
          aria-hidden="true"
          className="flex size-16 shrink-0 items-center justify-center rounded-full bg-x-cyan/15 text-xl font-semibold text-x-cyan-text dark:text-x-cyan"
        >
          {(view.displayName ?? view.username).slice(0, 1).toUpperCase()}
        </div>
        <div>
          <h1 className="text-2xl font-semibold">{view.displayName ?? view.username}</h1>
          <p className="text-sm text-current/60">@{view.username}</p>
        </div>
      </div>

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

      {view.bio && (
        <Card className="p-4">
          <MarkdownContent>{view.bio}</MarkdownContent>
        </Card>
      )}

      {(view.city || view.discordTag || view.birthDate) && (
        <Card className="p-4">
          <dl className="space-y-2 text-sm">
            {view.city && (
              <div className="flex gap-2">
                <dt className="font-medium">Stadt</dt>
                <dd>{view.city}</dd>
              </div>
            )}
            {view.discordTag && (
              <div className="flex gap-2">
                <dt className="font-medium">Discord</dt>
                <dd>{view.discordTag}</dd>
              </div>
            )}
            {view.birthDate && (
              <div className="flex gap-2">
                <dt className="font-medium">Geburtsdatum</dt>
                <dd>{formatDate(view.birthDate)}</dd>
              </div>
            )}
          </dl>
        </Card>
      )}

      <div className="flex flex-wrap gap-3 text-sm">
        {view.collectionVisible && (
          <Link href={`/collection/${subject.username}`} className="text-x-cyan-text underline hover:no-underline dark:text-x-cyan">
            Sammlung ansehen
          </Link>
        )}
        {view.decksVisible && (
          <Link href={`/decks/${subject.username}`} className="text-x-cyan-text underline hover:no-underline dark:text-x-cyan">
            Decks ansehen
          </Link>
        )}
      </div>

      {profileVisible && clubMemberships.length > 0 && (
        <section aria-labelledby="profile-clubs-heading" className="space-y-2">
          <h2 id="profile-clubs-heading" className="text-lg font-semibold">Clubs</h2>
          <div className="flex flex-wrap gap-2">
            {clubMemberships.map((m) => (
              <Link key={m.club.slug} href={`/clubs/${m.club.slug}`}>
                <Badge tone="cyan">{m.club.name}</Badge>
              </Link>
            ))}
          </div>
        </section>
      )}

      {profileVisible && tournamentHistory.length > 0 && (
        <section aria-labelledby="profile-tournaments-heading" className="space-y-2">
          <h2 id="profile-tournaments-heading" className="text-lg font-semibold">Turnierteilnahmen</h2>
          <Card className="divide-y p-0">
            {tournamentHistory.map((p) => (
              <Link
                key={p.tournament.id}
                href={`/events/${p.tournament.id}`}
                className="block px-4 py-3 hover:bg-current/5"
              >
                <p className="font-medium">{p.tournament.title}</p>
                <p className="text-sm text-current/60">{formatDate(p.tournament.startDate)}</p>
              </Link>
            ))}
          </Card>
        </section>
      )}

      {isOwner && (
        <Card className="p-4">
          <CardTitle className="mb-2 text-base">Das ist dein eigenes Profil</CardTitle>
          <Link href={`/profile/${subject.username}/friends`} className="text-x-cyan-text underline hover:no-underline dark:text-x-cyan">
            Freunde anzeigen
          </Link>
        </Card>
      )}
    </main>
  )
}
