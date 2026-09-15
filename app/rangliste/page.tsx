// app/rangliste/page.tsx (Phase 14; own-rank highlight + club filter + pagination added #199)
// Public leaderboard for the current ACTIVE season — no login required (matches the public-
// bracket-page precedent from Phase 5 Part C). Sorted by elo descending; minimum-games gating
// (master plan §4, lib/elo.ts's MIN_RATED_GAMES_FOR_LADDER): a player only appears once they've
// played 5+ rated matches this season — the row exists and updates internally below that, it
// just doesn't render here (avoids a 1-0 record showing as a false "#1").
//
// RC10 #28: ?season=<id> renders ANY season's standings (archive view of a COMPLETED season);
// when no season is ACTIVE, the empty state offers the last completed season as a link plus a
// notification offramp (inbox for signed-in users, login for guests) instead of dead-ending —
// CTA decisions live in lib/emptyStateActions.
//
// Issue #199 phase 1 ("klein, nutzt bestehende Datenlage direkt" per the issue's own concept
// comment): own-rank highlight (works even outside the current page — a viewer never just
// "disappears" past page 1 without feedback), a club filter (ClubMember ACTIVE join), and real
// pagination (#155-Pagination-Komponente) instead of the hard `take: 200` cutoff. The issue's
// further metrics (Win/Draw/Lose, Runden gespielt, bester Platz, …) need data this schema
// cannot currently answer per-season — see the issue's own "Erweitertes Konzept" comment — and
// are intentionally NOT part of this slice.
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getDictionary } from '@/lib/i18n/server'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Select } from '@/components/ui/Select'
import { Pagination } from '@/components/ui/Pagination'
import { MIN_RATED_GAMES_FOR_LADDER } from '@/lib/elo'
import { ranglisteEmptyActions } from '@/lib/emptyStateActions'

export const revalidate = 60 // public, frequently-mutated content [REVIEW-FIX: performance P16]

const ACTION_CLS = 'rounded-md px-4 py-2 text-sm font-medium transition-colors'
const PAGE_SIZE = 50

function pageNum(v: string | string[] | undefined): number {
  const n = typeof v === 'string' ? parseInt(v, 10) : NaN
  return Number.isFinite(n) && n >= 1 ? n : 1
}

export default async function RanglistePage({ searchParams }: PageProps<'/rangliste'>) {
  const { season: seasonParam, page, club } = await searchParams
  // RC14-Nachzügler #130 — page chrome comes from the request dictionary.
  const t = await getDictionary()
  const session = await auth()
  const viewerId = session?.user?.id ?? null

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
  const currentPage = Math.min(pageNum(page), totalPages ?? 1)

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
    skip: (currentPage - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
    select: { userId: true, elo: true, gamesPlayed: true, user: { select: { username: true, displayName: true } } },
  })

  const clubParams = new URLSearchParams()
  if (clubId) clubParams.set('club', clubId)
  const buildHref = (p: number) => {
    const params = new URLSearchParams(clubParams)
    params.set('page', String(p))
    return `/rangliste?${params.toString()}`
  }

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{t.leaderboard.heading}</h1>
        <Badge tone="cyan">{season.name}</Badge>
        {season.status === 'COMPLETED' && <Badge tone="neutral">{t.leaderboard.completed}</Badge>}
      </div>

      <form role="search" action="/rangliste" className="flex flex-wrap items-end gap-2">
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
              {viewerPage !== null && viewerPage !== currentPage && (
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
          <Card className="divide-y p-0">
            <div className="grid grid-cols-[3rem_1fr_5rem_5rem] gap-2 px-4 py-2 text-xs font-medium text-current/60">
              <span>#</span>
              <span>{t.leaderboard.colPlayer}</span>
              <span className="text-right">{t.leaderboard.colElo}</span>
              <span className="text-right">{t.leaderboard.colMatches}</span>
            </div>
            {ratings.map((r, i) => (
              <Link
                key={r.userId}
                href={`/profile/${r.user.username}`}
                className={`grid grid-cols-[3rem_1fr_5rem_5rem] items-center gap-2 px-4 py-2.5 text-sm hover:bg-current/5 ${
                  r.userId === viewerId ? 'bg-x-cyan/10' : ''
                }`}
              >
                <span className="tabular-nums text-current/60">{(currentPage - 1) * PAGE_SIZE + i + 1}</span>
                <span>{r.user.displayName ?? r.user.username}</span>
                <span className="text-right font-semibold tabular-nums">{r.elo}</span>
                <span className="text-right tabular-nums text-current/60">{r.gamesPlayed}</span>
              </Link>
            ))}
          </Card>
          {totalPages !== null && <Pagination page={currentPage} totalPages={totalPages} buildHref={buildHref} />}
        </>
      )}
    </main>
  )
}
