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
import { loadTournamentBracket, stageWinnersRounds } from '@/lib/bracket'
import { Badge } from '@/components/ui/Badge'
import { Card, CardTitle } from '@/components/ui/Card'
import { JudgeBracketView, eliminationRoundLabel } from '@/components/judge/JudgeBracketView'
import { OrganizerConsole } from '@/components/tournament/OrganizerConsole'
import { QrCodeSvg } from '@/components/tournament/QrCodeSvg'
import { renderQrSvg } from '@/lib/qr'

export const dynamic = 'force-dynamic' // live tournament surface [REVIEW-FIX: performance P16]
export default async function TournamentBracketPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ view?: string }>
}) {
  const { id } = await params
  const { view } = await searchParams
  const [tournament, session] = await Promise.all([loadTournamentBracket(id), auth()])
  if (!tournament) notFound()

  const me = session?.user?.id
  const caller = me ? await prismaCallerRole(me) : null
  const isOrganizer = me !== undefined && (tournament.createdById === me || caller === 'ADMIN')
  // Phase 10 item 2 — a shareable/bookmarkable ?view= toggle so the OrganizerConsole doesn't
  // permanently crowd the page for an organizer who's here as a spectator/player right now.
  // Defaults to Verwaltung (unchanged prior behavior) when the viewer IS the organizer.
  const managementView = isOrganizer && view !== 'teilnehmer'

  const players = [
    ...tournament.participants.map((p) => ({
      id: p.userId,
      name: p.user.displayName ?? p.user.username,
    })),
    // RC15 #12 — team mode: sub-game players resolve from the team-entry slots (participants
    // stays empty for a team tournament).
    ...tournament.teamEntries.flatMap((e) =>
      e.slots.map((s) => ({ id: s.userId, name: s.user.displayName ?? s.user.username }))
    ),
  ]
  const nameOf = (userId: string | null) =>
    userId === null ? null : (players.find((p) => p.id === userId)?.name ?? null)

  // "Mein nächstes Match": the viewer's first open match across all stages (player slot may only
  // be resolvable for round 1 — later rounds fill as predecessors complete). In team mode that
  // match is a sub-game; its parent encounter supplies round label and team-vs-team context.
  const myMatch = me
    ? tournament.stages.flatMap((s) => s.matches).find(
        (m) => m.status !== 'COMPLETED' && (m.player1Id === me || m.player2Id === me)
      )
    : undefined
  const myStage = myMatch ? tournament.stages.find((s) => s.matches.some((m) => m.id === myMatch.id)) : undefined
  const myOpponentId =
    myMatch && me ? (myMatch.player1Id === me ? myMatch.player2Id : myMatch.player1Id) : null
  const myEncounter =
    myMatch && myStage && tournament.teamMode
      ? myStage.teamMatches.find((tm) => tm.games.some((g) => g.id === myMatch.id))
      : undefined
  const myGameIndex = myEncounter ? myEncounter.games.findIndex((g) => g.id === myMatch!.id) : -1
  const myRoundLabel =
    myMatch && myStage
      ? tournament.teamMode && myEncounter
        ? eliminationRoundLabel(myEncounter.round, stageWinnersRounds(myStage.teamMatches))
        : myStage.format === 'SWISS' || myStage.format === 'ROUND_ROBIN'
          ? `Runde ${myMatch.swissRound ?? '?'}`
          : eliminationRoundLabel(myMatch.round, stageWinnersRounds(myStage.matches))
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

      {isOrganizer && (
        <div className="flex gap-2 text-sm" role="tablist" aria-label="Ansicht">
          <Link
            href={`/tournaments/${tournament.id}?view=teilnehmer`}
            role="tab"
            aria-selected={!managementView}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors ${!managementView ? 'bg-x-cyan text-base-dark' : 'border border-current/30 hover:bg-current/5'}`}
          >
            Teilnehmer
          </Link>
          <Link
            href={`/tournaments/${tournament.id}?view=verwaltung`}
            role="tab"
            aria-selected={managementView}
            className={`rounded-md px-3 py-1.5 font-medium transition-colors ${managementView ? 'bg-x-cyan text-base-dark' : 'border border-current/30 hover:bg-current/5'}`}
          >
            Verwaltung
          </Link>
        </div>
      )}

      {myMatch && (
        <Card className="space-y-1 border-neon-green/40 p-4">
          <CardTitle className="text-base">Mein nächstes Match</CardTitle>
          <p className="text-sm">
            {tournament.teamMode && myEncounter ? (
              <>
                <span className="text-current/50">{myRoundLabel}: </span>
                Spiel {myGameIndex + 1} — {myEncounter.team1Entry?.team.name ?? 'Offen'} vs.{' '}
                {myEncounter.team2Entry?.team.name ?? 'Offen'} ({myEncounter.winsTeam1}:{myEncounter.winsTeam2})
                {myOpponentId !== null && (
                  <> · du vs. {nameOf(myOpponentId) ?? 'Unbekannt'}</>
                )}
              </>
            ) : (
              <>
                <span className="text-current/50">{myRoundLabel}: </span>
                du vs. {myOpponentId === null ? 'steht noch nicht fest' : (nameOf(myOpponentId) ?? 'Unbekannt')}
              </>
            )}
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
            {/* RC15 #12 — team mode renders the encounter bracket (TeamMatch rows, entry ids as
                "players"); solo mode renders the match bracket as before. */}
            {tournament.teamMode ? (
              <JudgeBracketView
                matches={stage.teamMatches.map((m) => ({
                  id: m.id,
                  round: m.round,
                  bracketOrder: m.bracketOrder,
                  swissRound: null,
                  player1Id: m.team1Entry?.id ?? null,
                  player2Id: m.team2Entry?.id ?? null,
                  winnerId: m.winnerEntryId,
                  status: m.status,
                }))}
                players={tournament.teamEntries.map((e) => ({ id: e.id, name: e.team.name }))}
                format={stage.format}
                wbRounds={stageWinnersRounds(stage.teamMatches)}
                standings={[]}
              />
            ) : (
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
              wbRounds={stageWinnersRounds(stage.matches)}
              standings={stage.standings.map((s) => ({
                userId: s.userId,
                name: s.user.displayName ?? s.user.username,
                wins: s.wins,
                losses: s.losses,
                buchholz: s.buchholz,
              }))}
            />
            )}
          </section>
        ))
      )}

      {isOrganizer && managementView && (
        <OrganizerConsole
          tournamentId={tournament.id}
          teamMode={tournament.teamMode}
          teamEntries={tournament.teamEntries.map((e) => ({
            entryId: e.id,
            teamId: e.team.id,
            teamName: e.team.name,
            checkedIn: e.checkedIn,
            withdrawn: e.withdrawn,
          }))}
          participants={tournament.participants.map((p) => ({
            userId: p.userId,
            name: p.user.displayName ?? p.user.username,
            checkedIn: p.checkedIn,
            withdrawn: p.withdrawn,
            paidAt: p.paidAt?.toISOString() ?? null,
            seed: p.seed,
          }))}
          stages={tournament.stages.map((stage) => {
            const wbRounds = stageWinnersRounds(stage.matches)
            const teamWbRounds = stageWinnersRounds(stage.teamMatches)
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
              teamMatches: stage.teamMatches.map((tm) => ({
                id: tm.id,
                round: tm.round,
                label: eliminationRoundLabel(tm.round, teamWbRounds),
                team1: tm.team1Entry?.team.name ?? null,
                team2: tm.team2Entry?.team.name ?? null,
                status: tm.status,
                winsTeam1: tm.winsTeam1,
                winsTeam2: tm.winsTeam2,
                games: tm.games.map((g) => ({
                  id: g.id,
                  player1: nameOf(g.player1Id),
                  player2: nameOf(g.player2Id),
                  status: g.status,
                  judgeId: g.judgeId,
                })),
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
          startedAt={tournament.startedAt?.toISOString() ?? null}
          tournamentJudges={tournamentJudges}
          entryFeeCent={tournament.entryFeeCent}
          headerImageId={tournament.headerImageId}
        />
      )}

      {isOrganizer && managementView && checkInQrSvg && (
        <details className="rounded-md border border-x-cyan/20 p-3">
          <summary className="cursor-pointer text-sm font-medium">Check-in-QR-Code (Venue)</summary>
          <p className="mt-2 text-xs text-current/60">
            Aushängen oder auf einem Bildschirm anzeigen — Teilnehmer:innen scannen und checken
            sich damit selbst ein.
          </p>
          {/* Server-generated SVG (lib/qr.ts), injected post-hydration — same #98 pattern as TournamentShareQR. */}
          <div className="mt-3 flex justify-center">
            <QrCodeSvg svg={checkInQrSvg} />
          </div>
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
