// app/teams/page.tsx (RC15, issue #12)
// "Meine Teams": the viewer's team memberships (a team is a competitive 3-vs-3 roster, not a
// public directory — discovery happens via tournaments and clubs, so this page is auth-gated
// and lists only the caller's own teams, newest membership first). Guests get the sign-in
// prompt (Task 13 convention); team creation happens inline below the list.
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { Badge } from '@/components/ui/Badge'
import { Card, CardTitle } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { TeamCreateForm } from '@/components/teams/TeamCreateForm'

export const dynamic = 'force-dynamic'

export default async function TeamsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')
  const me = session.user.id

  const [memberships, clubMemberships] = await Promise.all([
    prisma.teamMember.findMany({
      where: { userId: me },
      orderBy: { joinedAt: 'desc' },
      include: {
        team: {
          include: {
            club: { select: { slug: true, name: true } },
            members: { select: { userId: true }, orderBy: { joinedAt: 'asc' } },
          },
        },
      },
    }),
    prisma.clubMember.findMany({
      where: { userId: me, status: 'ACTIVE' },
      orderBy: { joinedAt: 'asc' },
      select: { club: { select: { id: true, name: true } } },
    }),
  ])

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">Meine Teams</h1>
      <p className="text-sm text-current/70">
        Teams sind 3-gegen-3-Roster für Team-Turniere (WBO-Masters-League-Format) — mit genau 3
        Mitgliedern, die gemeinsam als Team angemeldet werden.
      </p>

      {memberships.length === 0 ? (
        <EmptyState
          title="Noch kein Team"
          description="Gründe unten dein erstes Team und lade zwei Mitspieler:innen ein — mit vollem Roster kannst du euch zu Team-Turnieren anmelden."
        />
      ) : (
        <ul className="space-y-2">
          {memberships.map((m) => (
            <li key={m.teamId}>
              <Link href={`/teams/${m.team.slug}`} className="block rounded-md border border-current/10 px-3 py-2 transition-colors hover:border-x-cyan/40">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {m.team.name}
                  {m.role === 'CAPTAIN' && <Badge tone="cyan">Captain</Badge>}
                  {m.team.club && <Badge tone="neutral">{m.team.club.name}</Badge>}
                  <Badge tone="neutral">{m.team.members.length}/3</Badge>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Card className="space-y-3 p-4">
        <CardTitle className="text-base">Neues Team gründen</CardTitle>
        <TeamCreateForm clubs={clubMemberships.map((m) => m.club)} />
      </Card>
    </main>
  )
}
