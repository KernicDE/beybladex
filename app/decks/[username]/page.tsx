// app/decks/[username]/page.tsx (Phase 10 item 4; MVP4/4 #144 — Visibility-Filter + Link)
// Another user's decks, read-only. Follows the /collection/[username] convention exactly:
// the subject is projected through resolveVisibleFields BEFORE anything renders, and the
// page 404s (not 403) when decksVisible is false — existence isn't leaked (standing
// not-403 privacy policy). #144: Die Liste respektiert die Deck-Sichtbarkeit — nur
// visibility=PUBLIC Decks sind gelistet; UNLISTED Decks sind nicht gelistet, aber niemals
// geheim (per Direktlink /decks/item/[id] und in Turnieren sichtbar). Seit #144 verlinkt
// die Karte auf die Detailseite (read-only für Nicht-Besitzer:innen).
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { resolveVisibleFields } from '@/lib/privacy'
import { isFriendWith } from '@/lib/friendship'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { TypeBadge } from '@/components/beyblade/TypeBadge'
import { buildPartSummary } from '@/components/beyblade/BuildCard'

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
    // #144 — nur öffentlich geschaltete Decks sind gelistet (UNLISTED = nicht gelistet,
    // aber per Direktlink/Turnier sichtbar — niemals geheim).
    where: { userId: subject.id, visibility: 'PUBLIC' },
    orderBy: { id: 'asc' },
    take: PAGE_SIZE,
    include: {
      builds: {
        orderBy: { position: 'asc' },
        include: {
          build: {
            select: { id: true, type: true, blade: { select: { id: true, name: true } }, lockChip: { select: { id: true, name: true } }, overBlade: { select: { id: true, name: true } }, metalBlade: { select: { id: true, name: true } }, assistBlade: { select: { id: true, name: true } }, ratchet: { select: { id: true, name: true } }, bit: { select: { id: true, name: true } } },
          },
        },
      },
    },
  })

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 p-4 sm:p-6">
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
                {/* #144 — Die Detailseite ist seit #144 für alle sichtbar (read-only). */}
                <Link href={`/decks/item/${deck.id}`} className="block space-y-2">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{deck.title}</p>
                    <Badge tone="neutral">{deck.builds.length}/3 Builds</Badge>
                  </div>
                  <ul className="text-sm text-current/60">
                    {deck.builds.map((db) => (
                      <li key={db.buildId} className="flex items-center gap-2">
                        <TypeBadge type={db.build.type} />
                        {buildPartSummary({ id: db.build.id, type: db.build.type, blade: db.build.blade, lockChip: db.build.lockChip, overBlade: db.build.overBlade, metalBlade: db.build.metalBlade, assistBlade: db.build.assistBlade, ratchet: db.build.ratchet, bit: db.build.bit })}
                      </li>
                    ))}
                  </ul>
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
