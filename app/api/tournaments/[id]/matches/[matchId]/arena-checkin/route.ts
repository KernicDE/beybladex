// app/api/tournaments/[id]/matches/[matchId]/arena-checkin/route.ts (Phase 7, item 3)
// Arena QR self-service check-in: a player scans their match's arena QR (or is marked present
// by tournament staff) to confirm they're at the stadium. AUTHZ RULE (standing Global-Constraints
// requirement): the self-service path requires the caller to be Match.player1Id or player2Id
// (403 not_a_player otherwise); the manual path additionally allows tournament staff
// (lib/tournamentJudges.ts's isTournamentStaff) to mark either player present via body.userId.
//
// CASCADE, explicit spec requirement: when a player's arena-checkin timestamp is set and their
// TournamentParticipant.checkedIn is not already true, this SAME transaction also sets
// checkedIn = true — being present at your arena for a match is strictly stronger evidence of
// event presence than the reverse (the cascade only runs arena -> event, never the other way).
// Once BOTH players are arena-checked-in, notify the match's assigned judge (reuses
// lib/notify.ts's notifyUser — no second notification mechanism).
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { rateLimit } from '@/lib/rateLimit'
import { notifyUser } from '@/lib/notify'
import { isTournamentStaff } from '@/lib/tournamentJudges'

type Ctx = { params: Promise<{ id: string; matchId: string }> }

export async function POST(req: Request, { params }: Ctx) {
  const session = await auth()
  if (!session?.user?.id) return Response.json({ error: 'unauthorized' }, { status: 401 })
  // [REVIEW-FIX: backend-security #37] arena QR scans arrive in bursts on match day — the
  // limit is deliberately high (5/s/user) so a judge scanning a queue is never throttled.
  const { allowed } = await rateLimit(`tournament:arena-checkin:${session.user.id}`, 300, 60)
  if (!allowed) return Response.json({ error: 'rate_limited' }, { status: 429 })
  const { id, matchId } = await params

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    // body is optional — self-service needs no fields
  }
  const targetUserId = typeof body.userId === 'string' && body.userId.length > 0 ? body.userId : null

  const tournament = await prisma.tournament.findUnique({ where: { id }, select: { createdById: true } })
  if (!tournament) return Response.json({ error: 'not_found' }, { status: 404 })

  const match = await prisma.match.findFirst({
    where: { id: matchId, tournamentId: id },
    select: { id: true, player1Id: true, player2Id: true, judgeId: true, player1ArenaCheckedInAt: true, player2ArenaCheckedInAt: true },
  })
  if (!match) return Response.json({ error: 'not_found' }, { status: 404 })

  const checkingInUserId = targetUserId ?? session.user.id
  const isSlot1 = checkingInUserId === match.player1Id
  const isSlot2 = checkingInUserId === match.player2Id
  if (!isSlot1 && !isSlot2) return Response.json({ error: 'not_a_player' }, { status: 400 })

  const isSelf = checkingInUserId === session.user.id
  if (!isSelf && !(await isTournamentStaff(id, session.user.id, tournament.createdById))) {
    return Response.json({ error: 'forbidden' }, { status: 403 })
  }

  const slotField = isSlot1 ? 'player1ArenaCheckedInAt' : 'player2ArenaCheckedInAt'
  const alreadyCheckedIn = isSlot1 ? match.player1ArenaCheckedInAt !== null : match.player2ArenaCheckedInAt !== null

  const updated = await prisma.$transaction(async (tx) => {
    const m = alreadyCheckedIn
      ? match
      : await tx.match.update({ where: { id: matchId }, data: { [slotField]: new Date() } })
    // Cascade: arena presence implies event presence (never the reverse).
    await tx.tournamentParticipant.updateMany({
      where: { tournamentId: id, userId: checkingInUserId, checkedIn: false },
      data: { checkedIn: true },
    })
    return m
  })

  const bothCheckedIn =
    updated.player1ArenaCheckedInAt !== null && updated.player2ArenaCheckedInAt !== null
  if (bothCheckedIn && !alreadyCheckedIn && match.judgeId) {
    await notifyUser(match.judgeId, {
      title: 'Beide Spieler:innen an der Arena',
      message: 'Beide Spieler:innen sind an ihrer Arena eingecheckt — das Match kann beginnen.',
      link: `/tournaments/${id}/judge`,
    })
  }

  return Response.json({
    id: updated.id,
    player1ArenaCheckedInAt: updated.player1ArenaCheckedInAt,
    player2ArenaCheckedInAt: updated.player2ArenaCheckedInAt,
  })
}
