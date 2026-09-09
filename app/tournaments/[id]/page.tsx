// app/tournaments/[id]/page.tsx
// Phase 5 Part C — the competitive/operational surface (Task 13 IA decision): the bracket view
// is PUBLIC (players, judges, spectators), plus an organizer console visible ONLY to the
// tournament's createdById or an ADMIN, plus a player-facing "Mein nächstes Match" callout.
// Live tournament surface → force-dynamic ([REVIEW-FIX: performance P16]). All bracket data
// comes from ONE findUnique include ([REVIEW-FIX: performance P6], lib/bracket.ts).
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { loadTournamentBracket } from '@/lib/bracket'
import { Badge } from '@/components/ui/Badge'
import { Card, CardTitle } from '@/components/ui/Card'
import { JudgeBracketView } from '@/components/judge/JudgeBracketView'
import { OrganizerConsole } from '@/components/tournament/OrganizerConsole'

export const dynamic = 'force-dynamic' // live tournament surface [REVIEW-FIX: performance P16]

function roundLabel(round: number, totalRounds: number): string {
  if (round === totalRounds && totalRounds > 1) return 'Finale'
  if (round === totalRounds - 1 && totalRounds > 2) return 'Halbfinale'
  return `Runde ${round}`
}

export default async function TournamentBracketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [tournament, session] = await Promise.all([loadTournamentBracket(id), auth()])
  if (!tournament) notFound()

  const me = session?.user?.id
  const caller = me ? await prismaCallerRole(me) : null
  const isOrganizer = me !== undefined && (tournament.createdById === me || caller === 'ADMIN')

  const players = tournament.participants.map((p) => ({
    id: p.userId,
    name: p.user.displayName ?? p.user.username,
  }))
  const nameOf = (userId: string | null) =>
    userId === null ? null : (players.find((p) => p.id === userId)?.name ?? null)
  const totalRounds = tournament.matches.reduce((max, m) => Math.max(max, m.round), 0)

  // "Mein nächstes Match": the viewer's first open match (player slot may only be resolvable
  // for round 1 — later rounds fill as predecessors complete).
  const myMatch = me
    ? tournament.matches.find(
        (m) => m.status !== 'COMPLETED' && (m.player1Id === me || m.player2Id === me)
      )
    : undefined
  const myOpponentId =
    myMatch && me ? (myMatch.player1Id === me ? myMatch.player2Id : myMatch.player1Id) : null

  // Judge pool for the assignment dropdown: the JUDGE role list is small by nature (a club/
  // region has a handful of certified judges); bounded at 200 as a sanity cap.
  const judges = isOrganizer
    ? await prismaJudges()
    : []

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{tournament.title}</h1>
        {tournament.completedAt && <Badge tone="green">Abgeschlossen</Badge>}
        <Badge tone="cyan">{tournament.ruleset.title}</Badge>
      </div>

      {myMatch && (
        <Card className="space-y-1 border-neon-green/40 p-4">
          <CardTitle className="text-base">Mein nächstes Match</CardTitle>
          <p className="text-sm">
            <span className="text-current/50">{roundLabel(myMatch.round, totalRounds)}: </span>
            du vs. {myOpponentId === null ? 'steht noch nicht fest' : (nameOf(myOpponentId) ?? 'Unbekannt')}
          </p>
          {myMatch.judgeId === me && (
            <Link
              href={`/tournaments/${tournament.id}/judge?match=${myMatch.id}`}
              className="inline-block rounded-md bg-x-cyan px-4 py-2 text-sm font-medium text-base-dark transition-colors hover:bg-x-cyan/85"
            >
              Judge-Oberfläche öffnen
            </Link>
          )}
        </Card>
      )}

      <section aria-labelledby="bracket-heading" className="space-y-3">
        <h2 id="bracket-heading" className="text-lg font-semibold">
          Turnierbaum
        </h2>
        {tournament.matches.length === 0 ? (
          <p className="text-sm text-current/60">
            Der Bracket wird vom Organisator generiert, sobald die Anmeldung geschlossen ist.
          </p>
        ) : (
          <JudgeBracketView
            matches={tournament.matches.map((m) => ({
              id: m.id,
              round: m.round,
              bracketOrder: m.bracketOrder,
              player1Id: m.player1Id,
              player2Id: m.player2Id,
              winnerId: m.winnerId,
              status: m.status,
            }))}
            players={players}
          />
        )}
      </section>

      {isOrganizer && (
        <OrganizerConsole
          tournamentId={tournament.id}
          participants={tournament.participants.map((p) => ({
            userId: p.userId,
            name: p.user.displayName ?? p.user.username,
            checkedIn: p.checkedIn,
            withdrawn: p.withdrawn,
          }))}
          matches={tournament.matches.map((m) => ({
            id: m.id,
            round: m.round,
            label: roundLabel(m.round, totalRounds),
            player1: nameOf(m.player1Id),
            player2: nameOf(m.player2Id),
            status: m.status,
            judgeId: m.judgeId,
          }))}
          judges={judges}
          bracketGenerated={tournament.matches.length > 0}
          completedAt={tournament.completedAt?.toISOString() ?? null}
        />
      )}

      <p className="text-sm">
        <Link href={`/events/${tournament.id}`} className="text-x-cyan-text hover:underline">
          ← Zur Event-Übersicht
        </Link>
      </p>
    </main>
  )
}

async function prismaCallerRole(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  return user?.role ?? null
}
async function prismaJudges() {
  const judges = await prisma.user.findMany({
    where: { role: 'JUDGE' },
    orderBy: { username: 'asc' },
    take: 200,
    select: { id: true, username: true, displayName: true },
  })
  return judges.map((j) => ({ id: j.id, name: j.displayName ?? j.username }))
}
