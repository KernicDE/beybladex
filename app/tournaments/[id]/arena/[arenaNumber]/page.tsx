// app/tournaments/[id]/arena/[arenaNumber]/page.tsx (Phase 7, item 3)
// The URL a PHYSICAL, fixed QR code at arena station N encodes — unlike a per-match QR (which
// would need reprinting every round), this resolves dynamically to whichever match currently
// has arenaNumber = N (lib/arenaAssign.ts assigns/frees this as matches complete). Renders the
// two players with a self-service arena-checkin button each; a player checks THEMSELVES in via
// the button matching their own name (the API rejects a non-player's self-service attempt —
// see the arena-checkin route). Organizer/staff can check in on a player's behalf too.
import { notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { Card } from '@/components/ui/Card'
import { isTournamentStaff } from '@/lib/tournamentJudges'
import { ArenaCheckinButton } from '@/components/tournament/ArenaCheckinButton'

export const dynamic = 'force-dynamic'

export default async function ArenaStationPage({
  params,
}: {
  params: Promise<{ id: string; arenaNumber: string }>
}) {
  const { id, arenaNumber } = await params
  const arenaNum = Number(arenaNumber)
  if (!Number.isInteger(arenaNum) || arenaNum < 1) notFound()

  const [tournament, session] = await Promise.all([
    prisma.tournament.findUnique({ where: { id }, select: { id: true, title: true, createdById: true } }),
    auth(),
  ])
  if (!tournament) notFound()

  const match = await prisma.match.findFirst({
    where: { tournamentId: id, arenaNumber: arenaNum, status: { not: 'COMPLETED' } },
    select: {
      id: true, player1Id: true, player2Id: true,
      player1ArenaCheckedInAt: true, player2ArenaCheckedInAt: true,
    },
  })
  // Match.player1Id/player2Id are plain FK columns, no named relation to User — resolve names
  // via a small separate lookup rather than an `include` that doesn't exist on the model.
  const playerIds = [match?.player1Id, match?.player2Id].filter((v): v is string => v !== null && v !== undefined)
  const playerNames = playerIds.length
    ? await prisma.user.findMany({ where: { id: { in: playerIds } }, select: { id: true, username: true, displayName: true } })
    : []
  const nameOf = (userId: string | null) => playerNames.find((u) => u.id === userId)

  const me = session?.user?.id
  const isStaff = me ? await isTournamentStaff(id, me, tournament.createdById) : false

  return (
    <main className="mx-auto w-full max-w-md flex-1 space-y-4 p-4 sm:p-6">
      <h1 className="text-xl font-semibold">
        Arena {arenaNum} — {tournament.title}
      </h1>
      <Card className="space-y-3 p-4">
        {!match ? (
          <p className="text-sm text-current/60">Aktuell ist dieser Arena kein Match zugewiesen.</p>
        ) : (
          [
            { id: match.player1Id, checkedInAt: match.player1ArenaCheckedInAt },
            { id: match.player2Id, checkedInAt: match.player2ArenaCheckedInAt },
          ].map((slot, i) =>
            slot.id === null ? (
              <p key={i} className="text-sm text-current/60">Spieler:in {i + 1} steht noch nicht fest.</p>
            ) : (
              <div key={slot.id} className="flex items-center justify-between gap-2">
                <span className="text-sm">{nameOf(slot.id)?.displayName ?? nameOf(slot.id)?.username}</span>
                <ArenaCheckinButton
                  tournamentId={id}
                  matchId={match.id}
                  playerId={slot.id}
                  isSelf={me === slot.id}
                  canMark={me === slot.id || isStaff}
                  alreadyCheckedIn={slot.checkedInAt !== null}
                />
              </div>
            )
          )
        )}
      </Card>
    </main>
  )
}
