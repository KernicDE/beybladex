// app/clubs/[slug]/page.tsx
// Club home: profile, roster, club-run tournaments, and the "Neues Club-Event" CTA (shown to
// the owner, isAdmin members, and global ORGANIZER/ADMIN sessions — the same rule the API
// enforces; it links to /events/new?clubId= which pre-selects the club in the form).
// Roster entries render only privacy-projected fields via resolveVisibleFields (the single
// privacy gate — never the raw user row).
// TODO: use lib/friendship.ts's areFriends batch helper (parallel track) for friendship-aware
// roster display once it lands — until then the roster renders in join order without it.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { resolveVisibleFields } from '@/lib/privacy'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardTitle } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { MarkdownContent } from '@/components/ui/MarkdownContent'
import { ClubActions, type ClubMemberRow } from '@/components/clubs/ClubActions'

export const revalidate = 120 // public, infrequently-mutated content [REVIEW-FIX: performance P16]

function formatDate(date: Date): string {
  return date.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
}

export default async function ClubPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const session = await auth()

  const club = await prisma.club.findUnique({
    where: { slug },
    include: {
      members: {
        orderBy: { joinedAt: 'asc' },
        include: {
          user: {
            select: {
              id: true, username: true, displayName: true, city: true, discordTag: true,
              bio: true, birthDate: true, isMinor: true,
              profileVisibility: true, locationVisibility: true, collectionVisibility: true,
              decksVisibility: true, ageVisibility: true,
            },
          },
        },
      },
    },
  })
  if (!club) notFound()

  const viewerId = session?.user?.id ?? null
  const viewerMembership = viewerId ? club.members.find((m) => m.userId === viewerId) : undefined
  const viewerRole = viewerId
    ? (await prisma.user.findUnique({ where: { id: viewerId }, select: { role: true } }))?.role
    : null

  // The single privacy gate for every roster row: only the projected fields are rendered below.
  const roster: ClubMemberRow[] = club.members.map((m) => {
    const visible = resolveVisibleFields(m.user, viewerId, false /* TODO(areFriends): batch helper */)
    return {
      userId: m.userId,
      username: visible.username,
      displayName: visible.displayName,
      isAdmin: m.isAdmin,
      isOwner: m.userId === club.ownerId,
    }
  })

  const tournaments = await prisma.tournament.findMany({
    where: { clubId: club.id },
    orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
    take: 24,
    select: { id: true, title: true, startDate: true, city: true, state: true, country: true, isRecurring: true },
  })

  const canManage = viewerMembership ? viewerMembership.isAdmin || viewerMembership.userId === club.ownerId : false
  const canCreateEvent = canManage || viewerRole === 'ORGANIZER' || viewerRole === 'ADMIN'

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">{club.name}</h1>
        {canCreateEvent && (
          <Link href={`/events/new?clubId=${club.id}`}>
            <Button>Neues Club-Event</Button>
          </Link>
        )}
      </div>

      {club.description && <MarkdownContent className="text-current/80">{club.description}</MarkdownContent>}

      <Card>
        <CardTitle className="mb-4">Mitglieder ({roster.length})</CardTitle>
        <CardContent>
          <ClubActions
            slug={club.slug}
            viewer={{ userId: viewerId, isMember: !!viewerMembership, canManage }}
            members={roster}
          />
        </CardContent>
      </Card>

      <section aria-label="Club-Turniere" className="space-y-3">
        <h2 className="text-lg font-semibold">Club-Turniere</h2>
        {tournaments.length === 0 ? (
          <EmptyState
            title="Noch keine Club-Turniere"
            description="Sobald für diesen Club ein Event erstellt wird, erscheint es hier."
          />
        ) : (
          <ul className="space-y-3">
            {tournaments.map((t) => (
              <li key={t.id}>
                <Card className="p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/events/${t.id}`} className="font-semibold hover:underline">
                      {t.title}
                    </Link>
                    {t.isRecurring && <Badge tone="cyan">Wiederkehrend</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-current/60">
                    {formatDate(t.startDate)} · {t.city}, {t.state} ({t.country})
                  </p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}
