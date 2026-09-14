// lib/decklockSweep.ts (Issue #181 — "Decklock")
// Two jobs, one pass over the same candidate tournaments:
//   1. REMINDER — participants without a deck, within 24h of the effective deck lock
//      (Tournament.deckLockAt, default startDate — lib/deckLock.ts), not yet reminded for the
//      current lock (TournamentParticipant.deckReminderSentAt null) get a Notification.
//   2. REMOVAL — once the effective lock has passed, participants still without a deck are
//      removed from the tournament (and notified why).
//
// OPERATIONAL GAP (same standing constraint as lib/metaCache.ts / lib/notificationCleanup.ts):
// this repo has no cron/worker process — runDecklockSweep() is ONLY ever invoked via
// POST /api/internal/decklock-sweep, which an external scheduler (system crontab on the deploy
// server, or a scheduled GitHub Actions workflow) must hit periodically (hourly is plenty: a
// 24h reminder window and a hard lock deadline don't need minute-level precision). Wiring that
// schedule is a deploy-time operational task, not application code.
//
// Scope: only BRACKET tournaments (STAMMTISCH/FREEPLAY have no ruleset/deck concept, see #176)
// that have NOT started yet (Tournament.startedAt null) and are not completed — once started,
// PATCH .../join already hard-blocks deck edits regardless of deckLockAt, and the deck-choice
// snapshot (lockedBuildIds) has already been taken; a sweep after that point would be a no-op
// at best and a race against the snapshot at worst.
import { prisma } from '@/lib/db'
import { notifyUser } from '@/lib/notify'
import { resolveDeckLockAt } from '@/lib/deckLock'

const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000

export interface DecklockSweepResult {
  remindersSent: number
  participantsRemoved: number
}

export async function runDecklockSweep(now: Date = new Date()): Promise<DecklockSweepResult> {
  const candidates = await prisma.tournament.findMany({
    where: {
      kind: 'BRACKET',
      startedAt: null,
      completedAt: null,
    },
    select: {
      id: true,
      title: true,
      startDate: true,
      deckLockAt: true,
      participants: {
        where: { deckId: null, withdrawn: false },
        select: { id: true, userId: true, deckReminderSentAt: true },
      },
    },
  })

  let remindersSent = 0
  let participantsRemoved = 0

  for (const tournament of candidates) {
    if (tournament.participants.length === 0) continue
    const lockAt = resolveDeckLockAt(tournament.deckLockAt, tournament.startDate)
    const msUntilLock = lockAt.getTime() - now.getTime()

    if (msUntilLock <= 0) {
      // Past the lock — remove every deck-less participant and let them know why.
      for (const p of tournament.participants) {
        await prisma.tournamentParticipant.delete({ where: { id: p.id } }).catch(() => {
          // Already gone (withdrew themselves, or a concurrent sweep run) — not an error.
        })
        await notifyUser(p.userId, {
          title: 'Aus Turnier entfernt — kein Deck hinterlegt',
          message: `Die Deck-Sperrfrist für „${tournament.title}“ ist abgelaufen, ohne dass du ein Deck hinterlegt hattest. Du wurdest deshalb aus der Teilnehmerliste entfernt.`,
          link: `/tournaments/${tournament.id}`,
        })
        participantsRemoved++
      }
      continue
    }

    if (msUntilLock <= REMINDER_WINDOW_MS) {
      const due = tournament.participants.filter((p) => p.deckReminderSentAt === null)
      for (const p of due) {
        await notifyUser(p.userId, {
          title: 'Deck fehlt noch',
          message: `Für „${tournament.title}“ musst du bis ${lockAt.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })} ein Deck hinterlegen — sonst wirst du automatisch aus der Teilnehmerliste entfernt.`,
          link: `/tournaments/${tournament.id}`,
        })
        await prisma.tournamentParticipant.update({
          where: { id: p.id },
          data: { deckReminderSentAt: now },
        })
        remindersSent++
      }
    }
  }

  return { remindersSent, participantsRemoved }
}
