// lib/teams.ts (RC15, issue #12 — MVP3 3-vs-3 team competition)
// The TEAM RULEBOOK as pure, HTTP-free functions: roster/lineup cardinality, the team-name
// contract, and the TeamMatch encounter state machine (best-of-3 over three slot-vs-slot
// sub-games). DB-touching orchestration lives in lib/teamStage.ts; this module owns the
// arithmetic and invariants, so the rules are unit-testable without a database and cannot
// drift between "what the server computes" and "what the tests assert" (same convention as
// lib/scoring.ts / lib/bracket.ts).
//
// DESIGN (master-plan MVP3 sketch, binding): Team is a competitive roster of EXACTLY 3
// players — deliberately separate from Club (persistent social community). The roster cap
// and the tournament lineup size are the same number by design: a team registers for a
// team-mode tournament with its three members, one per lineup slot (position 1..3).

/** Team-name bounds (club-name convention). */
export const TEAM_NAME_MIN = 2
export const TEAM_NAME_MAX = 40

/**
 * THE 3: a 3-vs-3 roster has exactly 3 active members (route-enforced cap on TeamMember) and
 * a tournament lineup is exactly those 3 members (TeamTournamentEntry slots). The two numbers
 * are identical by design — the roster IS the lineup.
 */
export const TEAM_SIZE = 3
export const MAX_TEAM_MEMBERS = TEAM_SIZE

/** Best-of-3: the first team to this many sub-game wins takes the encounter. */
export const ENCOUNTER_WINS_NEEDED = 2

export type TeamNameValidation = { ok: true; name: string } | { ok: false; error: 'invalid_name' }

/** Trims and validates a team name. Returns the canonical (trimmed) name on success. */
export function validateTeamName(input: unknown): TeamNameValidation {
  if (typeof input !== 'string') return { ok: false, error: 'invalid_name' }
  const name = input.trim()
  if (name.length < TEAM_NAME_MIN || name.length > TEAM_NAME_MAX) return { ok: false, error: 'invalid_name' }
  return { ok: true, name }
}

/**
 * Roster cardinality for tournament registration: the lineup is the roster, so a team can
 * register exactly when it has precisely TEAM_SIZE members. null = registrable; otherwise the
 * machine-readable reason ('team_incomplete' | 'roster_full').
 */
export function lineupError(activeMemberCount: number): string | null {
  if (activeMemberCount < TEAM_SIZE) return 'team_incomplete'
  if (activeMemberCount > TEAM_SIZE) return 'roster_full'
  return null
}

export interface EncounterGameState {
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED'
  /** Which team (side 1 = team1Entry, side 2 = team2Entry) won this sub-game; null unless COMPLETED. */
  winnerSide: 1 | 2 | null
}

export interface EncounterState {
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED'
  winsTeam1: number
  winsTeam2: number
  /** null while the encounter is open. */
  winnerSide: 1 | 2 | null
}

/**
 * THE ENCOUNTER STATE MACHINE (best-of-3): sub-game wins accumulate per side; the FIRST side
 * to ENCOUNTER_WINS_NEEDED (2) ends the encounter immediately — the third sub-game only ever
 * plays when the first two split 1-1. Defensive all-games-completed branch: with 3 games a
 * 2-win threshold can never tie, but if it ever did, the leader wins rather than the encounter
 * hanging open forever.
 */
export function encounterState(games: EncounterGameState[]): EncounterState {
  const winsTeam1 = games.filter((g) => g.status === 'COMPLETED' && g.winnerSide === 1).length
  const winsTeam2 = games.filter((g) => g.status === 'COMPLETED' && g.winnerSide === 2).length

  let winnerSide: 1 | 2 | null = null
  if (winsTeam1 >= ENCOUNTER_WINS_NEEDED) winnerSide = 1
  else if (winsTeam2 >= ENCOUNTER_WINS_NEEDED) winnerSide = 2
  else if (games.length > 0 && games.every((g) => g.status === 'COMPLETED')) {
    winnerSide = winsTeam1 > winsTeam2 ? 1 : winsTeam2 > winsTeam1 ? 2 : null
  }

  return {
    status: winnerSide !== null ? 'COMPLETED' : games.some((g) => g.status !== 'PENDING') ? 'IN_PROGRESS' : 'PENDING',
    winsTeam1,
    winsTeam2,
    winnerSide,
  }
}

export interface LineupSlot {
  position: number
  userId: string
}

/**
 * THE PAIRING RULE (fixed order, no captain-order games in v1): sub-game i pits team 1's slot
 * i against team 2's slot i. Both lineups must be complete (exactly TEAM_SIZE slots) — a
 * missing slot is a server-side bug, surfaced loudly rather than silently pairing undefined.
 */
export function encounterGamePlayers(team1Slots: LineupSlot[], team2Slots: LineupSlot[]): { player1Id: string; player2Id: string }[] {
  if (team1Slots.length !== TEAM_SIZE || team2Slots.length !== TEAM_SIZE) {
    throw new Error('encounter_lineup_incomplete')
  }
  const byPosition = (slots: LineupSlot[]) => new Map(slots.map((s) => [s.position, s.userId]))
  const t1 = byPosition(team1Slots)
  const t2 = byPosition(team2Slots)
  return Array.from({ length: TEAM_SIZE }, (_, i) => {
    const position = i + 1
    const player1Id = t1.get(position)
    const player2Id = t2.get(position)
    if (!player1Id || !player2Id) throw new Error('encounter_lineup_incomplete')
    return { player1Id, player2Id }
  })
}
