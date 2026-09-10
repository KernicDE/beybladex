// app/rangliste/page.tsx (Phase 14)
// Public leaderboard for the current ACTIVE season — no login required (matches the public-
// bracket-page precedent from Phase 5 Part C). Sorted by elo descending; minimum-games gating
// (master plan §4, lib/elo.ts's MIN_RATED_GAMES_FOR_LADDER): a player only appears once they've
// played 5+ rated matches this season — the row exists and updates internally below that, it
// just doesn't render here (avoids a 1-0 record showing as a false "#1").
import Link from 'next/link'
import { prisma } from '@/lib/db'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { MIN_RATED_GAMES_FOR_LADDER } from '@/lib/elo'

export const revalidate = 60 // public, frequently-mutated content [REVIEW-FIX: performance P16]

export default async function RanglistePage() {
  const season = await prisma.season.findFirst({ where: { status: 'ACTIVE' } })

  if (!season) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 p-4 sm:p-6">
        <h1 className="mb-4 text-2xl font-semibold">Rangliste</h1>
        <EmptyState title="Noch keine Season aktiv" description="Sobald eine Season gestartet wurde, erscheint hier die Rangliste." />
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
        <h1 className="text-2xl font-semibold">Rangliste</h1>
        <Badge tone="cyan">{season.name}</Badge>
      </div>

      {ratings.length === 0 ? (
        <EmptyState
          title="Noch keine gewerteten Spieler:innen"
          description={`Ein Rang erscheint erst ab ${MIN_RATED_GAMES_FOR_LADDER} gewerteten Matches in dieser Season.`}
        />
      ) : (
        <Card className="divide-y p-0">
          <div className="grid grid-cols-[3rem_1fr_5rem_5rem] gap-2 px-4 py-2 text-xs font-medium text-current/60">
            <span>#</span>
            <span>Spieler</span>
            <span className="text-right">Elo</span>
            <span className="text-right">Matches</span>
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
