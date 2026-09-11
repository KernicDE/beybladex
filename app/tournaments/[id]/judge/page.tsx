// app/tournaments/[id]/judge/page.tsx
// Phase 5 Part C — the judge scoring surface. force-dynamic (live tournament surface,
// [REVIEW-FIX: performance P16]). Access: the assigned judge of the selected match, the
// tournament's creator, or an ADMIN — everyone else gets a plain "no access" state (the score
// API enforces the same rule; this is the UI-side gate). Serializes the match, both players'
// registered deck builds (for the match-start build confirmation, [REVIEW-FIX: ux-product §4])
// and the Ruleset-derived point values into JudgeScorePad; the pad itself is offline-capable
// (IndexedDB queue + snapshot, lib/offline/matchQueue.ts).
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { JudgeScorePad, type PadPlayer } from '@/components/judge/JudgeScorePad'
import { eliminationRoundLabel } from '@/components/judge/JudgeBracketView'
import { stageWinnersRounds } from '@/lib/bracket'
import { pointValuesFor } from '@/lib/scoring'

export const dynamic = 'force-dynamic'

export default async function JudgePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ match?: string }>
}) {
  const { id } = await params
  const { match: matchParam } = await searchParams
  const session = await auth()
  const me = session?.user?.id

  const tournament = await prisma.tournament.findUnique({
    where: { id },
    include: {
      ruleset: true,
      stages: {
        orderBy: { order: 'asc' },
        include: {
          matches: { orderBy: [{ round: 'asc' }, { bracketOrder: 'asc' }] },
          // RC15 #12 — team mode: a judged match is a sub-game; its parent encounter supplies
          // the round label and the team-vs-team context.
          teamMatches: {
            orderBy: [{ round: 'asc' }, { bracketOrder: 'asc' }],
            include: {
              team1Entry: { select: { team: { select: { name: true } } } },
              team2Entry: { select: { team: { select: { name: true } } } },
              games: { orderBy: { bracketOrder: 'asc' } },
            },
          },
        },
      },
      participants: {
        include: {
          user: { select: { username: true, displayName: true } },
          deck: { include: { builds: { orderBy: { position: 'asc' }, include: { build: { include: { blade: true, ratchet: true, bit: true } } } } } },
        },
      },
      // RC15 #12 — team mode: sub-game players (deck + build snapshot) resolve via slots.
      teamEntries: {
        orderBy: { createdAt: 'asc' },
        include: {
          team: { select: { name: true } },
          slots: {
            orderBy: { position: 'asc' },
            include: {
              user: { select: { username: true, displayName: true } },
              deck: { include: { builds: { orderBy: { position: 'asc' }, include: { build: { include: { blade: true, ratchet: true, bit: true } } } } } },
            },
          },
        },
      },
    },
  })
  if (!tournament) notFound()

  // Phase 16 item 6 — once a locked-decks tournament has started, a participant's
  // lockedBuildIds SNAPSHOT (not their live deck) is authoritative: it may reference builds no
  // longer in their currently-editable Deck.builds, so it's fetched separately by id.
  // RC15 #12 — in team mode the snapshot lives on the team-entry slots instead.
  const lockedBuildIds = [
    ...new Set([
      ...tournament.participants.flatMap((p) => p.lockedBuildIds),
      ...tournament.teamEntries.flatMap((e) => e.slots.flatMap((s) => s.lockedBuildIds)),
    ]),
  ]
  const lockedBuilds = lockedBuildIds.length
    ? await prisma.build.findMany({ where: { id: { in: lockedBuildIds } }, include: { blade: true, ratchet: true, bit: true } })
    : []
  const lockedBuildById = new Map(lockedBuilds.map((b) => [b.id, b]))

  // Phase 5 Part C2: matches live on stages; the judge pad works on one flattened list.
  const matches = tournament.stages.flatMap((s) => s.matches)
  const stageOf = (matchId: string) => tournament.stages.find((s) => s.matches.some((m) => m.id === matchId))

  const caller = me ? await prisma.user.findUnique({ where: { id: me }, select: { role: true } }) : null
  const isOwner = me !== undefined && tournament.createdById === me
  const isAdmin = caller?.role === 'ADMIN'

  const accessible = matches.filter(
    (m) => m.judgeId === me || isOwner || isAdmin
  )
  const match =
    (matchParam ? accessible.find((m) => m.id === matchParam) : undefined) ??
    accessible.find((m) => m.status !== 'COMPLETED') ??
    accessible[0]

  if (!match || !me) {
    return (
      <main className="mx-auto w-full max-w-md flex-1 space-y-4 p-6">
        <h1 className="text-xl font-semibold">Judge-Bereich</h1>
        <p className="text-sm text-current/70">
          {me
            ? 'Du bist keinem Match dieses Turniers als Judge zugewiesen.'
            : 'Bitte melde dich an, um ein Match zu judgen.'}
        </p>
        <p className="text-sm">
          <Link href={`/tournaments/${tournament.id}`} className="text-x-cyan-text hover:underline">
            ← Zum Turnierbaum
          </Link>
        </p>
      </main>
    )
  }

  const stage = stageOf(match.id)! // match comes from the flattened stage list — always found
  // RC15 #12 — team mode: the judged match is a sub-game (round 0); label + team context come
  // from its parent encounter.
  const encounter = tournament.teamMode
    ? stage.teamMatches.find((tm) => tm.games.some((g) => g.id === match.id))
    : undefined
  const gameIndex = encounter ? encounter.games.findIndex((g) => g.id === match.id) : -1
  const maxRound = Math.max(0, ...stage.matches.map((m) => m.round))
  const wbRounds =
    maxRound > 0
      ? stage.matches.some((m) => m.bracketSide === 'GRAND_FINAL')
        ? (maxRound + 1) / 3
        : maxRound
      : 0
  const matchRoundLabel =
    encounter && gameIndex >= 0
      ? `${eliminationRoundLabel(encounter.round, stageWinnersRounds(stage.teamMatches))} · ` +
        `${encounter.team1Entry?.team.name ?? 'Offen'} vs. ${encounter.team2Entry?.team.name ?? 'Offen'} · ` +
        `Spiel ${gameIndex + 1} (${encounter.winsTeam1}:${encounter.winsTeam2})`
      : stage.format === 'SWISS'
        ? `Swiss-Runde ${match.swissRound ?? '?'}`
        : eliminationRoundLabel(match.round, wbRounds)
  // Phase 16 items 1-2 — a build's dual-spin status and suggested mode: true/suggested if ANY
  // of its three parts is dualSpin (priority blade → ratchet → bit for the suggestion, an
  // arbitrary but deterministic tie-break when more than one part is dual-spin).
  function dualSpinInfo(build: { blade: { dualSpin: boolean; spinDirection: 'RIGHT' | 'LEFT' }; ratchet: { dualSpin: boolean; spinDirection: 'RIGHT' | 'LEFT' }; bit: { dualSpin: boolean; spinDirection: 'RIGHT' | 'LEFT' } }) {
    const dualPart = [build.blade, build.ratchet, build.bit].find((p) => p.dualSpin)
    return { dualSpin: dualPart !== undefined, suggestedSpinMode: dualPart?.spinDirection ?? build.blade.spinDirection }
  }

  const padPlayer = (userId: string | null): PadPlayer | null => {
    if (userId === null) return null
    // RC15 #12 — team mode: the player row is a team-entry SLOT (deck + build snapshot live on
    // the slot); solo mode: the tournament participant. Both carry the same shape below.
    const slot = tournament.teamMode
      ? tournament.teamEntries.flatMap((e) => e.slots).find((s) => s.userId === userId)
      : undefined
    const row = slot ?? (tournament.teamMode ? undefined : tournament.participants.find((p) => p.userId === userId))
    if (!row) return { id: userId, name: 'Unbekannt', builds: [] }
    // Phase 16 item 6 — a non-empty lockedBuildIds snapshot (tournament started, locked-decks
    // ruleset) is authoritative over the live deck; see this file's own comment above.
    const buildRows =
      row.lockedBuildIds.length > 0
        ? row.lockedBuildIds.map((buildId) => lockedBuildById.get(buildId)).filter((b) => b !== undefined)
        : (row.deck?.builds ?? []).map((db) => db.build)
    return {
      id: userId,
      name: row.user.displayName ?? row.user.username,
      builds: buildRows.map((build) => ({
        id: build.id,
        label: `${build.blade.name} · ${build.ratchet.name} · ${build.bit.name}`,
        ...dualSpinInfo(build),
      })),
    }
  }

  // Point values derived server-side from the Ruleset — the pad displays local arithmetic with
  // these, and the score API recomputes authoritatively from the same Ruleset. lib/scoring.ts's
  // pointValuesFor is the ONE point table (issue #46): the old hand-rolled literal here was a
  // third copy that could drift from the server's applyEvent mid-match.
  const r = tournament.ruleset
  const pointValues = pointValuesFor(r)

  return (
    <JudgeScorePad
      matchId={match.id}
      tournamentId={tournament.id}
      roundLabel={matchRoundLabel}
      player1={padPlayer(match.player1Id)}
      player2={padPlayer(match.player2Id)}
      initial={{
        scorePlayer1: match.scorePlayer1,
        scorePlayer2: match.scorePlayer2,
        status: match.status,
        winnerId: match.winnerId,
        player1BuildId: match.player1BuildId,
        player2BuildId: match.player2BuildId,
        player1SpinMode: match.player1SpinMode,
        player2SpinMode: match.player2SpinMode,
      }}
      targetPoints={r.targetPoints}
      pointValues={pointValues}
    />
  )
}
