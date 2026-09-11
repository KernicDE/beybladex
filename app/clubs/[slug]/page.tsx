// app/clubs/[slug]/page.tsx
// Club home: profile (description + websiteUrl/discordUrl links, Phase 13), ACTIVE roster,
// Phase 12 club chat (member-only surface, authz enforced again by the API), club-run
// tournaments, and the "Neues Club-Event" CTA (shown to the owner, ACTIVE isAdmin members,
// and global ORGANIZER/ADMIN sessions — the same rule the API enforces; it links to
// /events/new?clubId= which pre-selects the club in the form).
// Phase 13 join policies: all membership reads go through lib/clubMembers.ts, the single
// place the ACTIVE status filter lives — the roster and member count can never include a
// pending application/invite. The viewer's OWN pending state is read separately so the UI
// can show "Bewerbung ausstehend"/"Einladung annehmen", and admins get the pending list.
// Roster entries render only privacy-projected fields via resolveVisibleFields (the single
// privacy gate — never the raw user row).
// TODO: use lib/friendship.ts's areFriends batch helper (parallel track) for friendship-aware
// roster display once it lands — until then the roster renders in join order without it.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { withPublicCache } from '@/lib/publicCache'
import { resolveVisibleFields } from '@/lib/privacy'
import { getActiveRoster, getPendingMemberships, getViewerMembership } from '@/lib/clubMembers'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card, CardContent, CardTitle } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { MarkdownContent } from '@/components/ui/MarkdownContent'
import { ClubActions, type ClubMemberRow } from '@/components/clubs/ClubActions'
import { ClubChat } from '@/components/clubs/ClubChat'
import { ClubForm } from '@/components/clubs/ClubForm'

// [RC5 #43] No `revalidate` export: auth() (viewer membership/role gates the roster
// projection, manage tier and chat) forces per-request rendering, so the old revalidate line
// never applied. Only the PUBLIC core — the club row and its event list — is cached in Redis
// for 120s (lib/publicCache.ts); every viewer-dependent read stays live per request.
const PUBLIC_CORE_TTL = 120

function formatDate(date: Date): string {
  return date.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
}

export default async function ClubPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const session = await auth()

  const club = await withPublicCache(`public:v1:club:${slug}`, PUBLIC_CORE_TTL, () =>
    prisma.club.findUnique({
      where: { slug },
      select: { id: true, name: true, slug: true, description: true, websiteUrl: true, discordUrl: true, joinPolicy: true, ownerId: true },
    }),
  )
  if (!club) notFound()

  const viewerId = session?.user?.id ?? null
  // ACTIVE-filtered roster — pending rows can never appear here (lib/clubMembers.ts).
  const activeMembers = await getActiveRoster(club.id)
  // The viewer's own membership, ANY status — needed for the pending-state UI ("Bewerbung
  // ausstehend" / "Einladung annehmen") and for the manage tier.
  const viewerMembership = viewerId ? await getViewerMembership(club.id, viewerId) : null
  const viewerRole = viewerId
    ? (await prisma.user.findUnique({ where: { id: viewerId }, select: { role: true } }))?.role
    : null

  // The single privacy gate for every roster row: only the projected fields are rendered below.
  const roster: ClubMemberRow[] = activeMembers.map((m) => {
    const visible = resolveVisibleFields(m.user, viewerId, false /* TODO(areFriends): batch helper */)
    return {
      userId: m.userId,
      username: visible.username,
      displayName: visible.displayName,
      isAdmin: m.isAdmin,
      isOwner: m.userId === club.ownerId,
    }
  })

  const tournaments = await withPublicCache(`public:v1:club-events:${club.id}`, PUBLIC_CORE_TTL, () =>
    prisma.tournament.findMany({
      where: { clubId: club.id },
      orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
      take: 24,
      select: { id: true, title: true, startDate: true, city: true, state: true, country: true, isRecurring: true },
    }),
  )

  const canManage =
    viewerMembership?.status === 'ACTIVE' && (viewerMembership.isAdmin || viewerId === club.ownerId)
  const canCreateEvent = canManage || viewerRole === 'ORGANIZER' || viewerRole === 'ADMIN'
  const pendingRows = canManage ? await getPendingMemberships(club.id) : []
  // Flatten the DB row shape ({ userId, status, user: { username, displayName } }) into
  // ClubActions' PendingMemberRow prop shape ({ userId, username, displayName, status }).
  const pendingList = pendingRows.map((row) => ({
    userId: row.userId,
    username: row.user.username,
    displayName: row.user.displayName,
    status: row.status as 'PENDING_APPLICATION' | 'PENDING_INVITE',
  }))

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

      {(club.websiteUrl || club.discordUrl) && (
        <p className="flex flex-wrap gap-4 text-sm">
          {club.websiteUrl && (
            <a href={club.websiteUrl} target="_blank" rel="noopener noreferrer" className="text-x-cyan-text hover:underline dark:text-x-cyan">
              Website
            </a>
          )}
          {club.discordUrl && (
            <a href={club.discordUrl} target="_blank" rel="noopener noreferrer" className="text-x-cyan-text hover:underline dark:text-x-cyan">
              Discord
            </a>
          )}
        </p>
      )}

      <Card>
        <CardTitle className="mb-4">Mitglieder ({roster.length})</CardTitle>
        <CardContent>
          <ClubActions
            slug={club.slug}
            joinPolicy={club.joinPolicy}
            viewer={{
              userId: viewerId,
              membershipStatus: viewerMembership?.status ?? 'NONE',
              canManage,
            }}
            members={roster}
            pending={pendingList}
          />
        </CardContent>
      </Card>

      <section aria-label="Club-Chat" className="space-y-3">
        <h2 className="text-lg font-semibold">Club-Chat</h2>
        <Card>
          <CardContent>
            {/* Chat is a member surface — the API enforces the same membership authz
                (403 for non-members), the component just doesn't render it for them.
                A PENDING_APPLICATION/PENDING_INVITE viewer is not yet an ACTIVE member
                either, so the same viewerMembership check correctly withholds chat access
                from them too (the API's own membership check is the authoritative gate). */}
            {viewerMembership?.status === 'ACTIVE' ? (
              <ClubChat slug={club.slug} viewer={{ userId: viewerId, canManage }} />
            ) : (
              <p className="text-sm text-current/60">Nur für Mitglieder des Clubs sichtbar.</p>
            )}
          </CardContent>
        </Card>
      </section>

      {canManage && (
        <Card>
          <CardTitle className="mb-4">Club-Einstellungen</CardTitle>
          <CardContent>
            <ClubForm
              initial={{
                slug: club.slug,
                description: club.description,
                websiteUrl: club.websiteUrl,
                discordUrl: club.discordUrl,
                joinPolicy: club.joinPolicy,
              }}
            />
          </CardContent>
        </Card>
      )}

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
