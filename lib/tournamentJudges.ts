// lib/tournamentJudges.ts (Phase 7)
// Shared authz helper: is this user an organizer/admin OR a judge specifically assigned to
// THIS tournament (TournamentJudge)? Per the spec's explicit requirement, the manual-marking
// tier for check-in/payment/arena actions must NOT be "any JUDGE role anywhere on the
// platform" — only the tournament's own createdById, a global ADMIN, or a row in
// TournamentJudge for this specific tournament.
import { prisma } from '@/lib/db'

export async function isTournamentStaff(tournamentId: string, userId: string, createdById: string): Promise<boolean> {
  if (userId === createdById) return true
  const caller = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (caller?.role === 'ADMIN') return true
  const judge = await prisma.tournamentJudge.findUnique({
    where: { tournamentId_userId: { tournamentId, userId } },
  })
  return judge !== null
}
