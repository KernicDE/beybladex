// app/rangliste/page.tsx (Phase 14; extended per issue #199)
// Public leaderboard — no login required (matches the public-bracket-page precedent from
// Phase 5 Part C). Five destinations behind a plain Link nav (NOT the client-side Tabs
// component — its tabs share one server-computed dataset per request, which works for
// same-shape sibling tabs like Builds' "mine"/"public" but would be actively wrong here: each
// of these five is a different query against a different table with different columns, so
// switching without a real navigation would show the wrong domain's data under the wrong
// headers):
//   • Season  — PlayerRating Elo ladder for one season (Phase 14 original + #199 phase 1's
//     own-rank highlight / club filter / pagination), now ALSO showing the count-based stats
//     below (wins/losses/rounds/tournaments/placement) scoped to that season's date window.
//   • Year / All-time — the SAME count-based stats with no Elo column. Elo is inherently
//     path-dependent (order of games matters) and can only ever be read from the season ladder
//     it accrued on — see lib/playerStats.ts's header comment — so these two scopes rank by
//     wins instead.
//   • Teams — the Team-Elo season ladder (lib/teamElo.ts, issue #198/#199 groundwork).
//   • Clubs — aggregated member Elo, sum AND average side by side (lib/clubRanking.ts; the
//     user's own decision when asked sum-vs-average: both, not one or the other).
//
// RC10 #28: ?season=<id> renders ANY season's standings (archive view of a COMPLETED season);
// when no season is ACTIVE, the empty state offers the last completed season as a link plus a
// notification offramp (inbox for signed-in users, login for guests) instead of dead-ending —
// CTA decisions live in lib/emptyStateActions.
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getDictionary, type Messages } from '@/lib/i18n/server'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Select } from '@/components/ui/Select'
import { Pagination } from '@/components/ui/Pagination'
import { MIN_RATED_GAMES_FOR_LADDER } from '@/lib/elo'
import { ranglisteEmptyActions } from '@/lib/emptyStateActions'
import { computePlayerStats, tournamentYears, yearScope, ALL_TIME_SCOPE, type PlayerStatRow } from '@/lib/playerStats'
import { computeClubRanking } from '@/lib/clubRanking'

export const revalidate = 60 // public, frequently-mutated content [REVIEW-FIX: performance P16]

const ACTION_CLS = 'rounded-md px-4 py-2 text-sm font-medium transition-colors'
const PAGE_SIZE = 50

function pageNum(v: string | string[] | undefined): number {
  const n = typeof v === 'string' ? parseInt(v, 10) : NaN
  return Number.isFinite(n) && n >= 1 ? n : 1
}

type Tab = 'season' | 'year' | 'alltime' | 'teams' | 'clubs'

function GroupNav({ active, t }: { active: Tab; t: Messages }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: 'season', label: t.leaderboard.tabSeason },
    { id: 'year', label: t.leaderboard.tabYear },
    { id: 'alltime', label: t.leaderboard.tabAllTime },
    { id: 'teams', label: t.leaderboard.tabTeams },
    { id: 'clubs', label: t.leaderboard.tabClubs },
  ]
  return (
    <div role="tablist" className="flex flex-wrap gap-1 border-b border-x-cyan/20">
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.id === 'season' ? '/rangliste' : `/rangliste?tab=${tab.id}`}
          role="tab"
          aria-selected={active === tab.id}
          className={`rounded-t-md px-4 py-2 text-sm font-medium transition-colors ${
            active === tab.id
              ? 'border-b-2 border-x-cyan-text text-x-cyan-text dark:border-x-cyan dark:text-x-cyan'
              : 'text-current/60 hover:text-current'
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  )
}

// #199 — shared "wins-ranked" stats table for the Year and All-time tabs (no Elo: see the
// module header comment on why Elo can't extend to these scopes). Sorted by wins desc, then
// matches played desc, then userId for full determinism; paginated in memory (see
// lib/playerStats.ts's own note on why that's an acceptable tradeoff at this platform's scale).
async function StatsTable({
  scope,
  page,
  buildHref,
  t,
}: {
  scope: { from: Date | null; to: Date | null }
  page: number
  buildHref: (p: number) => string
  t: Messages
}) {
  const statsByUser = await computePlayerStats(scope)
  const rows = [...statsByUser.values()]
    .filter((r) => r.matchesPlayed > 0)
    .sort((a, b) => b.wins - a.wins || b.matchesPlayed - a.matchesPlayed || a.userId.localeCompare(b.userId))

  if (rows.length === 0) {
    return <EmptyState title={t.leaderboard.noStatsTitle} description={t.leaderboard.noStatsDescription} />
  }

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageRows = rows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const users = await prisma.user.findMany({
    where: { id: { in: pageRows.map((r) => r.userId) } },
    select: { id: true, username: true, displayName: true },
  })
  const nameById = new Map(users.map((u) => [u.id, u.displayName ?? u.username]))
  const usernameById = new Map(users.map((u) => [u.id, u.username]))

  return (
    <>
      <Card className="divide-y overflow-x-auto p-0">
        <div className="grid min-w-[640px] grid-cols-[3rem_1fr_5rem_5rem_5rem_6rem_6rem_6rem] gap-2 px-4 py-2 text-xs font-medium text-current/60">
          <span>#</span>
          <span>{t.leaderboard.colPlayer}</span>
          <span className="text-right">{t.leaderboard.colWins}</span>
          <span className="text-right">{t.leaderboard.colLosses}</span>
          <span className="text-right">{t.leaderboard.colMatches}</span>
          <span className="text-right">{t.leaderboard.colTournaments}</span>
          <span className="text-right">{t.leaderboard.colBestPlacement}</span>
          <span className="text-right">{t.leaderboard.colAvgPlacement}</span>
        </div>
        {pageRows.map((r, i) => (
          <Link
            key={r.userId}
            href={`/profile/${usernameById.get(r.userId) ?? ''}`}
            className="grid min-w-[640px] grid-cols-[3rem_1fr_5rem_5rem_5rem_6rem_6rem_6rem] items-center gap-2 px-4 py-2.5 text-sm hover:bg-current/5"
          >
            <span className="tabular-nums text-current/60">{(currentPage - 1) * PAGE_SIZE + i + 1}</span>
            <span>{nameById.get(r.userId) ?? r.userId}</span>
            <span className="text-right font-semibold tabular-nums">{r.wins}</span>
            <span className="text-right tabular-nums text-current/60">{r.losses}</span>
            <span className="text-right tabular-nums text-current/60">{r.matchesPlayed}</span>
            <span className="text-right tabular-nums text-current/60">{r.tournamentsPlayed}</span>
            <span className="text-right tabular-nums text-current/60">{r.bestPlacement ?? t.leaderboard.noValue}</span>
            <span className="text-right tabular-nums text-current/60">{r.avgPlacement ?? t.leaderboard.noValue}</span>
          </Link>
        ))}
      </Card>
      <Pagination page={currentPage} totalPages={totalPages} buildHref={buildHref} />
    </>
  )
}

async function TeamsTab({ t }: { t: Messages }) {
  const season = await prisma.season.findFirst({ where: { status: 'ACTIVE' } })
  if (!season) {
    return <EmptyState title={t.leaderboard.noSeasonTitle} description={t.leaderboard.noSeasonDescription} />
  }
  const ratings = await prisma.teamRating.findMany({
    where: { seasonId: season.id, matchesPlayed: { gt: 0 } },
    orderBy: [{ elo: 'desc' }, { id: 'asc' }],
    take: PAGE_SIZE,
    select: { teamId: true, elo: true, matchesPlayed: true, team: { select: { name: true, slug: true } } },
  })
  if (ratings.length === 0) {
    return <EmptyState title={t.leaderboard.noTeamsTitle} description={t.leaderboard.noTeamsDescription} />
  }
  return (
    <Card className="divide-y p-0">
      <div className="grid grid-cols-[3rem_1fr_5rem_5rem] gap-2 px-4 py-2 text-xs font-medium text-current/60">
        <span>#</span>
        <span>{t.leaderboard.colTeam}</span>
        <span className="text-right">{t.leaderboard.colElo}</span>
        <span className="text-right">{t.leaderboard.colMatches}</span>
      </div>
      {ratings.map((r, i) => (
        <Link
          key={r.teamId}
          href={`/teams/${r.team.slug}`}
          className="grid grid-cols-[3rem_1fr_5rem_5rem] items-center gap-2 px-4 py-2.5 text-sm hover:bg-current/5"
        >
          <span className="tabular-nums text-current/60">{i + 1}</span>
          <span>{r.team.name}</span>
          <span className="text-right font-semibold tabular-nums">{r.elo}</span>
          <span className="text-right tabular-nums text-current/60">{r.matchesPlayed}</span>
        </Link>
      ))}
    </Card>
  )
}

async function ClubsTab({ t }: { t: Messages }) {
  const season = await prisma.season.findFirst({ where: { status: 'ACTIVE' } })
  if (!season) {
    return <EmptyState title={t.leaderboard.noSeasonTitle} description={t.leaderboard.noSeasonDescription} />
  }
  const rows = (await computeClubRanking(season.id)).sort((a, b) => b.sumElo - a.sumElo)
  if (rows.length === 0) {
    return <EmptyState title={t.leaderboard.noClubsTitle} description={t.leaderboard.noClubsDescription.replace('{min}', '3')} />
  }
  return (
    <Card className="divide-y p-0">
      <div className="grid grid-cols-[3rem_1fr_6rem_6rem_5rem] gap-2 px-4 py-2 text-xs font-medium text-current/60">
        <span>#</span>
        <span>{t.leaderboard.clubFilterLabel}</span>
        <span className="text-right">{t.leaderboard.colSumElo}</span>
        <span className="text-right">{t.leaderboard.colAvgElo}</span>
        <span className="text-right">{t.leaderboard.colMatches}</span>
      </div>
      {rows.map((r, i) => (
        <Link
          key={r.clubId}
          href={`/clubs/${r.slug}`}
          className="grid grid-cols-[3rem_1fr_6rem_6rem_5rem] items-center gap-2 px-4 py-2.5 text-sm hover:bg-current/5"
        >
          <span className="tabular-nums text-current/60">{i + 1}</span>
          <span>{r.name}</span>
          <span className="text-right font-semibold tabular-nums">{r.sumElo}</span>
          <span className="text-right tabular-nums text-current/60">{r.avgElo}</span>
          <span className="text-right tabular-nums text-current/60">{r.ratedMemberCount}</span>
        </Link>
      ))}
    </Card>
  )
}

export default async function RanglistePage({ searchParams }: PageProps<'/rangliste'>) {
  const { season: seasonParam, page, club, tab, year } = await searchParams
  // RC14-Nachzügler #130 — page chrome comes from the request dictionary.
  const t = await getDictionary()
  const session = await auth()
  const viewerId = session?.user?.id ?? null
  const activeTab: Tab = tab === 'year' || tab === 'alltime' || tab === 'teams' || tab === 'clubs' ? tab : 'season'
  const currentPage = pageNum(page)

  if (activeTab === 'teams' || activeTab === 'clubs') {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 p-4 sm:p-6">
        <h1 className="text-2xl font-semibold">{t.leaderboard.heading}</h1>
        <GroupNav active={activeTab} t={t} />
        <div className="pt-4">
          {activeTab === 'teams' ? <TeamsTab t={t} /> : <ClubsTab t={t} />}
        </div>
      </main>
    )
  }

  if (activeTab === 'year' || activeTab === 'alltime') {
    const years = activeTab === 'year' ? await tournamentYears() : []
    const selectedYear = activeTab === 'year' ? (Number(year) || years[0] || new Date().getUTCFullYear()) : null
    const scope = activeTab === 'year' && selectedYear ? yearScope(selectedYear) : ALL_TIME_SCOPE
    const buildHref = (p: number) => {
      const params = new URLSearchParams({ tab: activeTab, page: String(p) })
      if (selectedYear) params.set('year', String(selectedYear))
      return `/rangliste?${params.toString()}`
    }
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-4 p-4 sm:p-6">
        <h1 className="text-2xl font-semibold">{t.leaderboard.heading}</h1>
        <GroupNav active={activeTab} t={t} />
        <div className="space-y-4 pt-4">
          {activeTab === 'year' && years.length > 0 && (
            <form role="search" action="/rangliste" className="flex items-end gap-2">
              <input type="hidden" name="tab" value="year" />
              <div>
                <label htmlFor="rangliste-year" className="mb-1 block text-sm">{t.leaderboard.yearFilterLabel}</label>
                <Select id="rangliste-year" name="year" defaultValue={String(selectedYear)}>
                  {years.map((y) => (
                    <option key={y} value={y}>{y}</option>
                  ))}
                </Select>
              </div>
              <button type="submit" className="rounded-md bg-x-cyan px-4 py-2 text-sm font-medium text-base-dark transition-colors hover:bg-x-cyan/85">
                {t.common.search}
              </button>
            </form>
          )}
          <StatsTable scope={scope} page={currentPage} buildHref={buildHref} t={t} />
        </div>
      </main>
    )
  }

  // activeTab === 'season' — Phase 14 original + #199 phase 1 (own-rank/club-filter/pagination)
  // + #199 phase 2's extra count-based columns, scoped to the season's own date window.

  // Archive view (?season=id) wins; otherwise the ACTIVE season is the default.
  const requested = typeof seasonParam === 'string' && seasonParam
    ? await prisma.season.findUnique({ where: { id: seasonParam } })
    : null
  const season = requested ?? await prisma.season.findFirst({ where: { status: 'ACTIVE' } })

  if (!season) {
    // #28: explain AND offer next steps — the last completed season (if any) plus a
    // notification offramp, so the only public competitive surface never dead-ends.
    const lastSeason = await prisma.season.findFirst({
      where: { status: 'COMPLETED' },
      orderBy: { endsAt: 'desc' },
      select: { id: true, name: true },
    })
    const actions = ranglisteEmptyActions(
      { lastSeason, loggedIn: Boolean(viewerId) },
      { lastSeason: t.leaderboard.lastSeason, notifyInbox: t.leaderboard.notifyInbox, notifyLogin: t.leaderboard.notifyLogin },
    )
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 p-4 sm:p-6">
        <h1 className="mb-4 text-2xl font-semibold">{t.leaderboard.heading}</h1>
        <GroupNav active="season" t={t} />
        <div className="pt-6">
          <EmptyState
            title={t.leaderboard.noSeasonTitle}
            description={t.leaderboard.noSeasonDescription}
            action={
              <div className="flex flex-wrap justify-center gap-3">
                {actions.map((cta, i) => (
                  <Link
                    key={cta.href}
                    href={cta.href}
                    className={
                      i === 0
                        ? `${ACTION_CLS} bg-x-cyan text-base-dark hover:bg-x-cyan/85`
                        : `${ACTION_CLS} border border-current/30 hover:bg-current/5`
                    }
                  >
                    {cta.label}
                  </Link>
                ))}
              </div>
            }
          />
        </div>
      </main>
    )
  }

  const clubId = typeof club === 'string' && club ? club : null
  const clubs = await prisma.club.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } })

  // #199 — Club-Filter: nur User, die ACTIVE Mitglied des gewählten Clubs sind.
  const where = {
    seasonId: season.id,
    gamesPlayed: { gte: MIN_RATED_GAMES_FOR_LADDER },
    ...(clubId ? { user: { clubMemberships: { some: { clubId, status: 'ACTIVE' as const } } } } : {}),
  }

  const totalCount = await prisma.playerRating.count({ where })
  const totalPages = totalCount === 0 ? null : Math.max(1, Math.ceil(totalCount / PAGE_SIZE))
  const resolvedPage = Math.min(currentPage, totalPages ?? 1)

  // #199 — eigene Position: Rang = Anzahl Spieler:innen mit mehr Elo (im selben gefilterten
  // Scope) + 1. Separater COUNT-Query statt eines Fensters über die ganze Liste — bleibt O(1)
  // unabhängig von der Ligagröße, kein Laden aller Zeilen nur für den eigenen Rang.
  let viewerRank: number | null = null
  if (viewerId) {
    const viewerRating = await prisma.playerRating.findUnique({
      where: { seasonId_userId: { seasonId: season.id, userId: viewerId } },
      select: { elo: true, gamesPlayed: true },
    })
    if (viewerRating && viewerRating.gamesPlayed >= MIN_RATED_GAMES_FOR_LADDER) {
      const isMemberOfFilter = clubId
        ? await prisma.clubMember.findFirst({ where: { clubId, userId: viewerId, status: 'ACTIVE' }, select: { id: true } })
        : true
      if (isMemberOfFilter) {
        const ahead = await prisma.playerRating.count({ where: { ...where, elo: { gt: viewerRating.elo } } })
        viewerRank = ahead + 1
      }
    }
  }
  const viewerPage = viewerRank !== null ? Math.ceil(viewerRank / PAGE_SIZE) : null

  const ratings = await prisma.playerRating.findMany({
    where,
    orderBy: [{ elo: 'desc' }, { id: 'asc' }], // #199 — id-Tiebreaker: stabile Reihenfolge über Seiten hinweg bei Elo-Gleichstand
    skip: (resolvedPage - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: { userId: true, elo: true, gamesPlayed: true, user: { select: { username: true, displayName: true } } },
  })

  // #199 phase 2 — count-based columns for the rows on THIS page, scoped to the season's own
  // date window (its [startsAt, endsAt) — the same interpretation Year-scope uses for a
  // calendar year, see lib/playerStats.ts's header comment on why this is a defensible
  // retroactive reading rather than a byte-for-byte replay of Elo's own season attribution).
  const statsByUser = await computePlayerStats({ from: season.startsAt, to: season.endsAt })
  const emptyStats: Omit<PlayerStatRow, 'userId'> = { matchesPlayed: 0, wins: 0, losses: 0, roundsPlayed: 0, tournamentsPlayed: 0, bestPlacement: null, avgPlacement: null }

  const clubParams = new URLSearchParams()
  if (clubId) clubParams.set('club', clubId)
  const buildHref = (p: number) => {
    const params = new URLSearchParams(clubParams)
    params.set('page', String(p))
    return `/rangliste?${params.toString()}`
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{t.leaderboard.heading}</h1>
        <Badge tone="cyan">{season.name}</Badge>
        {season.status === 'COMPLETED' && <Badge tone="neutral">{t.leaderboard.completed}</Badge>}
      </div>

      <GroupNav active="season" t={t} />

      <form role="search" action="/rangliste" className="flex flex-wrap items-end gap-2 pt-2">
        <div>
          <label htmlFor="rangliste-club" className="mb-1 block text-sm">{t.leaderboard.clubFilterLabel}</label>
          <Select id="rangliste-club" name="club" defaultValue={clubId ?? ''}>
            <option value="">{t.leaderboard.clubFilterAll}</option>
            {clubs.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </div>
        <button type="submit" className="rounded-md bg-x-cyan px-4 py-2 text-sm font-medium text-base-dark transition-colors hover:bg-x-cyan/85">
          {t.common.search}
        </button>
      </form>

      {viewerId && (
        <p className="text-sm text-current/70">
          {viewerRank !== null ? (
            <>
              {t.leaderboard.yourRank.replace('{rank}', String(viewerRank))}
              {viewerPage !== null && viewerPage !== resolvedPage && (
                <>
                  {' · '}
                  <Link href={buildHref(viewerPage)} className="text-x-cyan-text underline underline-offset-2 dark:text-x-cyan">
                    {t.leaderboard.jumpToRank}
                  </Link>
                </>
              )}
            </>
          ) : (
            t.leaderboard.notRanked.replace('{min}', String(MIN_RATED_GAMES_FOR_LADDER))
          )}
        </p>
      )}

      {ratings.length === 0 ? (
        <EmptyState
          title={t.leaderboard.noPlayersTitle}
          description={t.leaderboard.noPlayersDescription.replace('{min}', String(MIN_RATED_GAMES_FOR_LADDER))}
        />
      ) : (
        <>
          <Card className="divide-y overflow-x-auto p-0">
            <div className="grid min-w-[760px] grid-cols-[3rem_1fr_5rem_5rem_5rem_5rem_6rem_6rem_6rem] gap-2 px-4 py-2 text-xs font-medium text-current/60">
              <span>#</span>
              <span>{t.leaderboard.colPlayer}</span>
              <span className="text-right">{t.leaderboard.colElo}</span>
              <span className="text-right">{t.leaderboard.colMatches}</span>
              <span className="text-right">{t.leaderboard.colWins}</span>
              <span className="text-right">{t.leaderboard.colLosses}</span>
              <span className="text-right">{t.leaderboard.colTournaments}</span>
              <span className="text-right">{t.leaderboard.colBestPlacement}</span>
              <span className="text-right">{t.leaderboard.colAvgPlacement}</span>
            </div>
            {ratings.map((r, i) => {
              const s = statsByUser.get(r.userId) ?? { ...emptyStats, userId: r.userId }
              return (
                <Link
                  key={r.userId}
                  href={`/profile/${r.user.username}`}
                  className={`grid min-w-[760px] grid-cols-[3rem_1fr_5rem_5rem_5rem_5rem_6rem_6rem_6rem] items-center gap-2 px-4 py-2.5 text-sm hover:bg-current/5 ${
                    r.userId === viewerId ? 'bg-x-cyan/10' : ''
                  }`}
                >
                  <span className="tabular-nums text-current/60">{(resolvedPage - 1) * PAGE_SIZE + i + 1}</span>
                  <span>{r.user.displayName ?? r.user.username}</span>
                  <span className="text-right font-semibold tabular-nums">{r.elo}</span>
                  <span className="text-right tabular-nums text-current/60">{r.gamesPlayed}</span>
                  <span className="text-right tabular-nums text-current/60">{s.wins}</span>
                  <span className="text-right tabular-nums text-current/60">{s.losses}</span>
                  <span className="text-right tabular-nums text-current/60">{s.tournamentsPlayed}</span>
                  <span className="text-right tabular-nums text-current/60">{s.bestPlacement ?? t.leaderboard.noValue}</span>
                  <span className="text-right tabular-nums text-current/60">{s.avgPlacement ?? t.leaderboard.noValue}</span>
                </Link>
              )
            })}
          </Card>
          {/* #155 — echte Seitenzahlen statt "Weitere laden". */}
          {totalPages !== null && <Pagination page={resolvedPage} totalPages={totalPages} buildHref={buildHref} />}
        </>
      )}
    </main>
  )
}
