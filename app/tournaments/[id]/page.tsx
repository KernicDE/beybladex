// app/tournaments/[id]/page.tsx
// Phase 5 Part C — the competitive/operational surface (Task 13 IA decision): the bracket view
// is PUBLIC (players, judges, spectators), plus an organizer console visible ONLY to the
// tournament's createdById or an ADMIN, plus a player-facing "Mein nächstes Match" callout.
// Phase 5 Part C2: the bracket view is a per-STAGE list (each stage has its own format; a Swiss
// stage renders standings + pairings instead of a bracket graph). Live tournament surface →
// force-dynamic ([REVIEW-FIX: performance P16]). All bracket data comes from ONE findUnique
// include ([REVIEW-FIX: performance P6], lib/bracket.ts).
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { loadTournamentBracket } from '@/lib/bracket'
import { Badge } from '@/components/ui/Badge'
import { Card, CardTitle } from '@/components/ui/Card'
import { JudgeBracketView, eliminationRoundLabel } from '@/components/judge/JudgeBracketView'
import { OrganizerConsole } from '@/components/tournament/OrganizerConsole'
import { renderQrSvg } from '@/lib/qr'

export const dynamic = 'force-dynamic' // live tournament surface [REVIEW-FIX: performance P16]

type LoadedTournament = NonNullable<Awaited<ReturnType<typeof loadTournamentBracket>>>

// Per-stage winners-bracket round count R (double-elimination: maxRound = 3R−1; single-elimination:
// maxRound = R). Swiss stages return 0 (round numbers unused).
function stageWinnersRounds(stage: LoadedTournament['stages'][number]): number {
  const maxRound = Math.max(0, ...stage.matches.map((m) => m.round))
  if (maxRound === 0) return 0
  return stage.matches.some((m) => m.bracketSide === 'GRAND_FINAL') ? (maxRound + 1) / 3 : maxRound
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

  // "Mein nächstes Match": the viewer's first open match across all stages (player slot may only
  // be resolvable for round 1 — later rounds fill as predecessors complete).
  const myMatch = me
    ? tournament.stages.flatMap((s) => s.matches).find(
        (m) => m.status !== 'COMPLETED' && (m.player1Id === me || m.player2Id === me)
      )
    : undefined
  const myStage = myMatch ? tournament.stages.find((s) => s.matches.some((m) => m.id === myMatch.id)) : undefined
  const myOpponentId =
    myMatch && me ? (myMatch.player1Id === me ? myMatch.player2Id : myMatch.player1Id) : null
  const myRoundLabel =
    myMatch && myStage
      ? myStage.format === 'SWISS' || myStage.format === 'ROUND_ROBIN'
        ? `Runde ${myMatch.swissRound ?? '?'}`
        : eliminationRoundLabel(myMatch.round, stageWinnersRounds(myStage))
      : null

  // Judge pool for the assignment dropdown: the JUDGE role list is small by nature (a club/
  // region has a handful of certified judges); bounded at 200 as a sanity cap.
  const judges = isOrganizer
    ? await prismaJudges()
    : []
  // Phase 7: the tournament's own check-in QR (organizer-only — the token is a self-service
  // check-in credential, never rendered for non-organizers) and its per-tournament staff roster.
  const [checkInQrSvg, tournamentJudgeRows] = isOrganizer
    ? await Promise.all([
        renderQrSvg(`${process.env.NEXTAUTH_URL ?? 'https://beybladex.de'}/events/${id}/checkin?t=${tournament.checkInToken}`),
        prisma.tournamentJudge.findMany({
          where: { tournamentId: id },
          select: { userId: true, user: { select: { username: true, displayName: true } } },
          orderBy: { createdAt: 'asc' },
        }),
      ])
    : [null, []]
  const tournamentJudges = tournamentJudgeRows.map((j) => ({ id: j.userId, name: j.user.displayName ?? j.user.username }))

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
            <span className="text-current/50">{myRoundLabel}: </span>
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

      {tournament.stages.length === 0 ? (
        <p className="text-sm text-current/60">
          Der Turnierbaum wird vom Organisator generiert, sobald die Anmeldung geschlossen ist.
        </p>
      ) : (
        tournament.stages.map((stage) => (
          <section key={stage.id} aria-labelledby={`stage-view-${stage.id}`} className="space-y-3">
            <h2 id={`stage-view-${stage.id}`} className="text-lg font-semibold">
              {stage.order}. {stage.name}
              {stage.status === 'COMPLETED' && <Badge tone="green" className="ml-2">Abgeschlossen</Badge>}
            </h2>
            <JudgeBracketView
              matches={stage.matches.map((m) => ({
                id: m.id,
                round: m.round,
                bracketOrder: m.bracketOrder,
                swissRound: m.swissRound,
                player1Id: m.player1Id,
                player2Id: m.player2Id,
                winnerId: m.winnerId,
                status: m.status,
              }))}
              players={players}
              format={stage.format}
              wbRounds={stageWinnersRounds(stage)}
              standings={stage.standings.map((s) => ({
                userId: s.userId,
                name: s.user.displayName ?? s.user.username,
                wins: s.wins,
                losses: s.losses,
                buchholz: s.buchholz,
              }))}
            />
          </section>
        ))
      )}

      {isOrganizer && (
        <OrganizerConsole
          tournamentId={tournament.id}
          participants={tournament.participants.map((p) => ({
            userId: p.userId,
            name: p.user.displayName ?? p.user.username,
            checkedIn: p.checkedIn,
            withdrawn: p.withdrawn,
            paidAt: p.paidAt?.toISOString() ?? null,
          }))}
          stages={tournament.stages.map((stage) => {
            const wbRounds = stageWinnersRounds(stage)
            return {
              id: stage.id,
              order: stage.order,
              name: stage.name,
              format: stage.format,
              status: stage.status,
              swissRounds: stage.swissRounds,
              swissRoundsDone: stage.swissRoundsDone,
              qualifyCount: stage.qualifyCount,
              matches: stage.matches.map((m) => ({
                id: m.id,
                stageId: stage.id,
                round: m.round,
                label:
                  stage.format === 'SWISS' || stage.format === 'ROUND_ROBIN'
                    ? `Runde ${m.swissRound ?? '?'}`
                    : eliminationRoundLabel(m.round, wbRounds),
                player1: nameOf(m.player1Id),
                player2: nameOf(m.player2Id),
                status: m.status,
                judgeId: m.judgeId,
              })),
              standings: stage.standings.map((s) => ({
                userId: s.userId,
                name: s.user.displayName ?? s.user.username,
                wins: s.wins,
                losses: s.losses,
                buchholz: s.buchholz,
              })),
            }
          })}
          judges={judges}
          completedAt={tournament.completedAt?.toISOString() ?? null}
          tournamentJudges={tournamentJudges}
          entryFeeCent={tournament.entryFeeCent}
        />
      )}

      {isOrganizer && checkInQrSvg && (
        <details className="rounded-md border border-x-cyan/20 p-3">
          <summary className="cursor-pointer text-sm font-medium">Check-in-QR-Code (Venue)</summary>
          <p className="mt-2 text-xs text-current/60">
            Aushängen oder auf einem Bildschirm anzeigen — Teilnehmer:innen scannen und checken
            sich damit selbst ein.
          </p>
          {/* Server-generated SVG from our own trusted lib/qr.ts — not user content. */}
          <div className="mt-3 flex justify-center [&_svg]:h-48 [&_svg]:w-48" dangerouslySetInnerHTML={{ __html: checkInQrSvg }} />
        </details>
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
