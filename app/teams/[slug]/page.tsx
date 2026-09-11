// app/teams/[slug]/page.tsx (RC15, issue #12)
// Team detail: name, optional club affiliation, the 3-member roster with captain controls,
// and (for captains) settings/disband. Registration for team tournaments happens from the
// event page itself — this page manages the roster, not tournament entries.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { Badge } from '@/components/ui/Badge'
import { Card, CardTitle } from '@/components/ui/Card'
import { TeamMembersPanel } from '@/components/teams/TeamMembersPanel'
import { TeamSettingsPanel } from '@/components/teams/TeamSettingsPanel'

export const dynamic = 'force-dynamic'

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
        include: { user: { select: { id: true, username: true, displayName: true } } },
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

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{team.name}</h1>
        {team.club && (
          <Link href={`/clubs/${team.club.slug}`}>
            <Badge tone="neutral">{team.club.name}</Badge>
          </Link>
        )}
      </div>
      <p className="text-sm text-current/70">
        3-gegen-3-Roster{team.club ? ` von ${team.club.name}` : ''} — mit vollem Roster kann euch
        die Captain:innen zu Team-Turnieren anmelden.
      </p>

      <TeamMembersPanel
        slug={team.slug}
        members={members.map((m) => ({
          userId: m.userId,
          name: m.user.displayName ?? m.user.username,
          role: m.role,
        }))}
        viewerId={me ?? ''}
        viewerIsCaptain={viewerIsCaptain}
      />

      {viewerIsCaptain && (
        <Card className="space-y-3 p-4">
          <CardTitle className="text-base">Team-Verwaltung</CardTitle>
          <TeamSettingsPanel slug={team.slug} name={team.name} />
        </Card>
      )}

      <p className="text-sm">
        <Link href="/teams" className="text-x-cyan-text hover:underline">
          ← Meine Teams
        </Link>
      </p>
    </main>
  )
}
