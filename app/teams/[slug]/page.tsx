// app/teams/[slug]/page.tsx (RC15, issue #12; public profile/logo/chat/stats added #198)
// Team detail: crest/logo, description, optional club affiliation, the 3-member roster with
// captain controls and avatars, public win/loss record + tournament history, member-only
// team chat, and (for captains) settings. Public — no auth() gate; registration for team
// tournaments happens from the event page itself, this page manages the roster/profile.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getTeamStats } from '@/lib/teamStats'
import { Badge } from '@/components/ui/Badge'
import { Card, CardContent, CardTitle } from '@/components/ui/Card'
import { MarkdownContent } from '@/components/ui/MarkdownContent'
import { EmptyState } from '@/components/ui/EmptyState'
import { TeamMembersPanel } from '@/components/teams/TeamMembersPanel'
import { TeamSettingsPanel } from '@/components/teams/TeamSettingsPanel'
import { TeamChat } from '@/components/teams/TeamChat'

export const dynamic = 'force-dynamic'

function formatDate(date: Date): string {
  return date.toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' })
}

const RESULT_LABEL: Record<string, { label: string; tone: 'green' | 'attack' | 'neutral' | 'cyan' }> = {
  win: { label: 'Sieg', tone: 'green' },
  loss: { label: 'Niederlage', tone: 'attack' },
  draw: { label: 'Unentschieden', tone: 'neutral' },
  in_progress: { label: 'Läuft', tone: 'cyan' },
}

export default async function TeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const session = await auth()
  const me = session?.user?.id

  const team = await prisma.team.findUnique({
    where: { slug },
    include: {
      club: { select: { slug: true, name: true } },
      members: {
        orderBy: { joinedAt: 'asc' },
        include: { user: { select: { id: true, username: true, displayName: true, avatarImageId: true } } },
      },
    },
  })
  if (!team) notFound()

  const myMembership = me ? team.members.find((m) => m.userId === me) : undefined
  const caller = me ? await prisma.user.findUnique({ where: { id: me }, select: { role: true } }) : null
  const viewerIsCaptain = myMembership?.role === 'CAPTAIN' || caller?.role === 'ADMIN'
  // Roster display order: captains first, then join order ('CAPTAIN' < 'MEMBER' ascending).
  const members = [...team.members].sort((a, b) =>
    a.role === b.role ? 0 : a.role === 'CAPTAIN' ? -1 : 1
  )

  const { record, history } = await getTeamStats(team.id)

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        {team.logoImageId ? (
          // eslint-disable-next-line @next/next/no-img-element -- public team crest, always visible (no privacy gate — same as a club logo would be)
          <img src={`/api/media/${team.logoImageId}`} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover" />
        ) : (
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-x-cyan/15 text-xl font-semibold text-x-cyan-text dark:text-x-cyan">
            {team.name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{team.name}</h1>
          {team.club && (
            <Link href={`/clubs/${team.club.slug}`}>
              <Badge tone="neutral">{team.club.name}</Badge>
            </Link>
          )}
        </div>
      </div>

      {team.description ? (
        <MarkdownContent className="text-current/80">{team.description}</MarkdownContent>
      ) : (
        <p className="text-sm text-current/70">
          3-gegen-3-Roster{team.club ? ` von ${team.club.name}` : ''} — mit vollem Roster kann euch
          die Captain:innen zu Team-Turnieren anmelden.
        </p>
      )}

      {/* Issue #198 — öffentliche Statistiken für 3on3-Matches, unabhängig vom Login-Status. */}
      <Card>
        <CardTitle className="mb-3">Statistik</CardTitle>
        <CardContent>
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-current/60">Matches</dt>
              <dd className="text-lg font-semibold">{record.played}</dd>
            </div>
            <div>
              <dt className="text-xs text-current/60">Siege</dt>
              <dd className="text-lg font-semibold text-type-defense">{record.wins}</dd>
            </div>
            <div>
              <dt className="text-xs text-current/60">Niederlagen</dt>
              <dd className="text-lg font-semibold text-type-attack">{record.losses}</dd>
            </div>
            <div>
              <dt className="text-xs text-current/60">Unentschieden</dt>
              <dd className="text-lg font-semibold">{record.draws}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <TeamMembersPanel
        slug={team.slug}
        members={members.map((m) => ({
          userId: m.userId,
          name: m.user.displayName ?? m.user.username,
          role: m.role,
          avatarImageId: m.user.avatarImageId,
        }))}
        viewerId={me ?? ''}
        viewerIsCaptain={viewerIsCaptain}
      />

      <section aria-label="Turnierhistorie" className="space-y-3">
        <h2 className="text-lg font-semibold">Turnierhistorie</h2>
        {history.length === 0 ? (
          <EmptyState title="Noch keine Turniere" description="Sobald sich dieses Team zu einem Team-Turnier anmeldet, erscheint es hier." />
        ) : (
          <ul className="space-y-2">
            {history.map((h) => {
              const result = RESULT_LABEL[h.result]!
              return (
                <li key={h.tournamentId}>
                  <Card className="flex flex-wrap items-center justify-between gap-2 p-3">
                    <Link href={`/events/${h.tournamentId}`} className="font-medium hover:underline">
                      {h.title}
                    </Link>
                    <span className="flex items-center gap-2 text-sm text-current/60">
                      {formatDate(h.startDate)}
                      <Badge tone={result.tone}>{result.label}</Badge>
                    </span>
                  </Card>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Issue #198 — Team-Chat, nur für Mitglieder (Server erzwingt dieselbe Mitgliedschaftsprüfung). */}
      <section aria-label="Team-Chat" className="space-y-3">
        <h2 className="text-lg font-semibold">Team-Chat</h2>
        <Card>
          <CardContent>
            {myMembership ? (
              <TeamChat slug={team.slug} viewer={{ userId: me ?? null, canManage: viewerIsCaptain }} />
            ) : (
              <p className="text-sm text-current/60">Nur für Mitglieder des Teams sichtbar.</p>
            )}
          </CardContent>
        </Card>
      </section>

      {viewerIsCaptain && (
        <Card className="space-y-3 p-4">
          <CardTitle className="text-base">Team-Verwaltung</CardTitle>
          <TeamSettingsPanel slug={team.slug} name={team.name} description={team.description} logoImageId={team.logoImageId} />
        </Card>
      )}

      <p className="text-sm">
        <Link href="/teams" className="text-x-cyan-text hover:underline">
          ← Alle Teams
        </Link>
      </p>
    </main>
  )
}
