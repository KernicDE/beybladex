// app/rangliste/page.tsx (Phase 14)
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
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getDictionary } from '@/lib/i18n/server'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { MIN_RATED_GAMES_FOR_LADDER } from '@/lib/elo'
import { ranglisteEmptyActions } from '@/lib/emptyStateActions'

export const revalidate = 60 // public, frequently-mutated content [REVIEW-FIX: performance P16]

const ACTION_CLS = 'rounded-md px-4 py-2 text-sm font-medium transition-colors'

export default async function RanglistePage({ searchParams }: PageProps<'/rangliste'>) {
  const { season: seasonParam } = await searchParams
  // RC14-Nachzügler #130 — page chrome comes from the request dictionary.
  const t = await getDictionary()
  const session = await auth()

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
      { lastSeason, loggedIn: Boolean(session?.user?.id) },
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

  const ratings = await prisma.playerRating.findMany({
    where: { seasonId: season.id, gamesPlayed: { gte: MIN_RATED_GAMES_FOR_LADDER } },
    orderBy: { elo: 'desc' },
    take: 200,
    select: { userId: true, elo: true, gamesPlayed: true, user: { select: { username: true, displayName: true } } },
  })

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{t.leaderboard.heading}</h1>
        <Badge tone="cyan">{season.name}</Badge>
        {season.status === 'COMPLETED' && <Badge tone="neutral">{t.leaderboard.completed}</Badge>}
      </div>

      {ratings.length === 0 ? (
        <EmptyState
          title={t.leaderboard.noPlayersTitle}
          description={t.leaderboard.noPlayersDescription.replace('{min}', String(MIN_RATED_GAMES_FOR_LADDER))}
        />
      ) : (
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
              className="grid grid-cols-[3rem_1fr_5rem_5rem] items-center gap-2 px-4 py-2.5 text-sm hover:bg-current/5"
            >
              <span className="tabular-nums text-current/60">{i + 1}</span>
              <span>{r.user.displayName ?? r.user.username}</span>
              <span className="text-right font-semibold tabular-nums">{r.elo}</span>
              <span className="text-right tabular-nums text-current/60">{r.gamesPlayed}</span>
            </Link>
          ))}
        </Card>
      )}
    </main>
  )
}
