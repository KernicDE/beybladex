// app/teams/page.tsx (RC15, issue #12; public directory + guest access added #197/#198)
// Two tabs, same pattern as /builds and /collection:
//   • "Meine Teams" — the viewer's own memberships (gated; a GuestTabBanner replaces the
//     panel for guests instead of a full-page block, since the directory tab is public —
//     this supersedes #197's original full-page GuestGate treatment for /teams, which
//     predated the directory tab and would now also hide it from guests).
//   • "Alle Teams" — public directory with search (name) and an "aktiv" filter. "Aktiv" is
//     defined here as a full 3-member roster (the only objectively determinable "can
//     compete" state — the issue itself doesn't define the term further).
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getDictionary } from '@/lib/i18n/server'
import { Badge } from '@/components/ui/Badge'
import { Card, CardTitle } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Tabs, type TabDef } from '@/components/ui/Tabs'
import { TeamCreateForm } from '@/components/teams/TeamCreateForm'
import { GuestTabBanner } from '@/components/auth/GuestTabBanner'

export const dynamic = 'force-dynamic'

function str(v: string | string[] | undefined): string {
  return typeof v === 'string' ? v : ''
}

export default async function TeamsPage({ searchParams }: PageProps<'/teams'>) {
  const { tab, q, active } = await searchParams
  // RC14-Nachzügler #130 — page chrome comes from the request dictionary.
  const t = await getDictionary()
  const session = await auth()
  const me = session?.user?.id ?? null
  const isGuest = me === null

  const activeTab = isGuest ? 'all' : tab === 'all' ? 'all' : 'mine'
  const query = str(q).trim()
  const activeOnly = active === '1'

  const allTeams = await prisma.team.findMany({
    where: query ? { name: { contains: query, mode: 'insensitive' } } : undefined,
    orderBy: { name: 'asc' },
    include: {
      club: { select: { slug: true, name: true } },
      members: { select: { userId: true } },
    },
    take: 100,
  })
  const filteredTeams = activeOnly ? allTeams.filter((team) => team.members.length === 3) : allTeams
  const directoryFilterActive = Boolean(query || activeOnly)

  const directoryContent = (
    <div className="space-y-6">
      <form role="search" action="/teams" className="grid items-end gap-3 sm:grid-cols-[1fr_auto_auto]">
        <input type="hidden" name="tab" value="all" />
        <div>
          <label htmlFor="teams-q" className="mb-1 block text-sm">{t.teamsPage.searchLabel}</label>
          <Input id="teams-q" name="q" type="search" defaultValue={query} placeholder={t.teamsPage.searchPlaceholder} />
        </div>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input type="checkbox" name="active" value="1" defaultChecked={activeOnly} className="size-4 accent-x-cyan-text" />
          {t.teamsPage.activeOnly}
        </label>
        <button type="submit" className="rounded-md bg-x-cyan px-4 py-2 text-sm font-medium text-base-dark transition-colors hover:bg-x-cyan/85">
          {t.common.search}
        </button>
      </form>

      {filteredTeams.length === 0 ? (
        <EmptyState
          title={directoryFilterActive ? t.teamsPage.emptyDirectoryFilteredTitle : t.teamsPage.emptyDirectoryTitle}
          description={directoryFilterActive ? t.teamsPage.emptyDirectoryFilteredDescription : t.teamsPage.emptyDirectoryDescription}
          action={directoryFilterActive ? (
            <Link href="/teams?tab=all" className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium transition-colors hover:bg-current/5">
              {t.catalog.reset}
            </Link>
          ) : undefined}
        />
      ) : (
        <ul className="space-y-2">
          {filteredTeams.map((team) => (
            <li key={team.id}>
              <Link href={`/teams/${team.slug}`} className="flex items-center gap-3 rounded-md border border-current/10 px-3 py-2 transition-colors hover:border-x-cyan/40">
                {team.logoImageId ? (
                  // eslint-disable-next-line @next/next/no-img-element -- small 32px directory list avatar
                  <img src={`/api/media/${team.logoImageId}`} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
                ) : (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-x-cyan/15 text-xs font-semibold text-x-cyan-text dark:text-x-cyan">
                    {team.name.slice(0, 1).toUpperCase()}
                  </span>
                )}
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {team.name}
                  {team.club && <Badge tone="neutral">{team.club.name}</Badge>}
                  <Badge tone={team.members.length === 3 ? 'green' : 'neutral'}>{team.members.length}/3</Badge>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  const mineContent = isGuest ? (
    <GuestTabBanner
      title={t.teamsPage.gateMineTitle}
      description={t.teamsPage.gateMineDescription}
      callbackUrl="/teams?tab=mine"
      labels={t.guestGate}
    />
  ) : (
    <MineTab me={me} t={t} />
  )

  const tabs: TabDef[] = [
    { id: 'mine', label: t.teamsPage.tabMine, content: mineContent },
    { id: 'all', label: t.teamsPage.tabAll, content: directoryContent },
  ]

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">{t.teamsPage.heading}</h1>
      <p className="text-sm text-current/70">{t.teamsPage.intro}</p>

      <Tabs tabs={tabs} defaultTab={activeTab} />
    </main>
  )
}

async function MineTab({ me, t }: { me: string; t: Awaited<ReturnType<typeof getDictionary>> }) {
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
    <div className="space-y-6">
      {memberships.length === 0 ? (
        <EmptyState
          title={t.teamsPage.emptyTitle}
          description={t.teamsPage.emptyDescription}
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
        <CardTitle className="text-base">{t.teamsPage.createTitle}</CardTitle>
        <TeamCreateForm clubs={clubMemberships.map((m) => m.club)} />
      </Card>
    </div>
  )
}
