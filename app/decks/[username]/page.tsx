// app/decks/[username]/page.tsx (Phase 10 item 4)
// Another user's decks, read-only. Follows the /collection/[username] convention exactly:
// the subject is projected through resolveVisibleFields BEFORE anything renders, and the
// page 404s (not 403) when decksVisible is false — existence isn't leaked (standing
// not-403 privacy policy). Unlike /collection/[username], this page does NOT link through to
// /decks/item/[id] — that route is still owner-only (see its own header comment: public deck
// detail sharing via decksVisible is a separate, not-yet-built feature) — so each deck's
// build summary renders inline here instead of behind a click-through that would 404 anyway.
import { notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { resolveVisibleFields } from '@/lib/privacy'
import { isFriendWith } from '@/lib/friendship'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { TypeBadge } from '@/components/beyblade/TypeBadge'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20

export default async function UserDecksPage({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params
  const session = await auth()
  const viewerId = session?.user?.id ?? null

  const subject = await prisma.user.findUnique({
    where: { username },
    select: {
      id: true, username: true, displayName: true, city: true, discordTag: true, bio: true,
      birthDate: true, isMinor: true, avatarImageId: true, profileVisibility: true, locationVisibility: true,
      collectionVisibility: true, decksVisibility: true, ageVisibility: true,
    },
  })
  if (!subject) notFound()

  const isFriend = viewerId ? await isFriendWith(viewerId, subject.id) : false
  const view = resolveVisibleFields(subject, viewerId, isFriend)
  if (!view.decksVisible) notFound()

  const decks = await prisma.deck.findMany({
    where: { userId: subject.id },
    orderBy: { id: 'asc' },
    take: PAGE_SIZE,
    include: {
      builds: {
        orderBy: { position: 'asc' },
        include: {
          build: {
            select: { id: true, type: true, blade: { select: { name: true } }, ratchet: { select: { name: true } }, bit: { select: { name: true } } },
          },
        },
      },
    },
  })

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">Decks von {view.displayName ?? view.username}</h1>

      {decks.length === 0 ? (
        <EmptyState
          title="Noch keine Decks"
          description={`${view.username} hat noch keine Decks angelegt.`}
        />
      ) : (
        <ul className="space-y-3">
          {decks.map((deck) => (
            <li key={deck.id}>
              <Card className="space-y-2 p-4">
                <div className="flex items-center gap-2">
                  <p className="font-medium">{deck.title}</p>
                  <Badge tone="neutral">{deck.builds.length}/3 Builds</Badge>
                </div>
                <ul className="text-sm text-current/60">
                  {deck.builds.map((db) => (
                    <li key={db.buildId} className="flex items-center gap-2">
                      <TypeBadge type={db.build.type} />
                      {db.build.blade.name} · {db.build.ratchet.name} · {db.build.bit.name}
                    </li>
                  ))}
                </ul>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
