// lib/deckRegistration.ts (RC15, issue #12 — extracted from
// app/api/tournaments/[id]/join/route.ts, Phase 16 item 5)
// Re-validates a chosen deck against the TOURNAMENT'S linked Ruleset.deckFormat at
// registration/deck-edit time — a deck is a personal, reusable object, so format compliance
// is only decidable where a format is known (the tournament). Shared by the solo join route
// and the team-mode slot route (a slot's deck has exactly the same contract).
import { prisma } from '@/lib/db'
import { validateDeckForFormat } from '@/lib/deckValidation'

/** Returns null (valid) or the error payload the route responds with. */
export async function validateDeckAgainstTournamentFormat(
  deckId: string,
  tournamentId: string
): Promise<{ error: string; conflicts?: string[] } | null> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { ruleset: { select: { deckFormat: true } } },
  })
  if (!tournament) return { error: 'not_found' }
  const deck = await prisma.deck.findUnique({
    where: { id: deckId },
    include: {
      builds: {
        include: {
          build: {
            select: {
              id: true, bladeId: true, ratchetId: true, bitId: true,
              blade: { select: { name: true } }, ratchet: { select: { name: true } }, bit: { select: { name: true } },
            },
          },
        },
      },
    },
  })
  if (!deck) return { error: 'invalid_deck' }
  const { valid, conflicts } = validateDeckForFormat(deck.builds.map((db) => db.build), tournament.ruleset.deckFormat)
  if (!valid) return { error: 'deck_format_mismatch', conflicts }
  return null
}
