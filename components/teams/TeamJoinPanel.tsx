// components/teams/TeamJoinPanel.tsx (RC15, issue #12)
// Client-side TEAM registration / check-in / withdrawal controls for the public event detail
// page of a team-mode tournament. AUTHZ (server-enforced, this is the UX): only a team's
// CAPTAIN may register or withdraw it; any lineup member may check the team in (self-service,
// same idea as the solo check-in button). Teams register ROSTER-COMPLETE only — the
// button only appears for the viewer's captain teams that already have exactly 3 members;
// incomplete rosters get an actionable hint instead of a dead button.
// RC14-Nachzügler #130 — copy comes from the request dictionary via the optional `labels`
// prop (German defaults keep not-yet-translated call sites working).
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { TEAM_SIZE } from '@/lib/teams'

export interface MyTeamInfo {
  id: string
  name: string
  slug: string
  memberCount: number
  isCaptain: boolean
}

export interface TeamJoinLabels {
  registered: string
  checkedIn: string
  checkIn: string
  withdraw: string
  ready: string
  register: string
  incompleteBefore: string
  completeRoster: string
  incompleteAfter: string
  noTeamsBefore: string
  createTeam: string
  noTeamsAfter: string
  captainsOnly: string
  errorRegistrationClosed: string
  errorTeamIncomplete: string
  errorRosterFull: string
  errorAlreadyRegistered: string
  errorTournamentStarted: string
  errorBracketExists: string
  errorForbidden: string
  errorGeneric: string
}

const DEFAULT_LABELS: TeamJoinLabels = {
  registered: 'Dein Team „{team}“ ist angemeldet.',
  checkedIn: 'Eingecheckt.',
  checkIn: 'Team einchecken',
  withdraw: 'Team abmelden',
  ready: 'Dein Team „{team}“ ({count}/3) ist startbereit.',
  register: 'Team anmelden',
  incompleteBefore: 'hat {count}/3 Mitglieder —',
  completeRoster: 'Roster vervollständigen',
  incompleteAfter: ', um das Team anzumelden.',
  noTeamsBefore: 'Team-Turnier:',
  createTeam: 'Gründe ein Team',
  noTeamsAfter: 'mit genau 3 Mitgliedern, um teilzunehmen.',
  captainsOnly: 'Nur die Team-Captain:innen können ein Team anmelden.',
  errorRegistrationClosed: 'Die Anmeldung ist geschlossen.',
  errorTeamIncomplete: 'Das Team braucht genau 3 Mitglieder für die Anmeldung.',
  errorRosterFull: 'Das Team hat mehr als 3 Mitglieder — für 3-gegen-3 muss der Roster passen.',
  errorAlreadyRegistered: 'Ein Mitglied ist bereits mit einem anderen Team angemeldet.',
  errorTournamentStarted: 'Das Turnier hat bereits begonnen.',
  errorBracketExists: 'Der Turnierbaum ist bereits erzeugt — Abmeldung ist nicht mehr möglich.',
  errorForbidden: 'Nur die Team-Captain:innen können das Team (ab)melden.',
  errorGeneric: 'Das hat leider nicht geklappt. Bitte versuche es erneut.',
}

/** {token} placeholder replacement — the messages carry named slots like {team}/{count}. */
function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? `{${key}}`))
}

export function TeamJoinPanel({
  tournamentId,
  myTeams,
  registeredTeamIds,
  myEntry,
  checkInOpen,
  canWithdraw,
  labels = DEFAULT_LABELS,
}: {
  tournamentId: string
  /** All teams the viewer is a member of. */
  myTeams: MyTeamInfo[]
  /** Team ids already registered for THIS tournament. */
  registeredTeamIds: string[]
  /** The viewer's team's entry, when registered. */
  myEntry: { entryId: string; teamId: string; teamName: string; checkedIn: boolean; viewerInLineup: boolean } | null
  checkInOpen: boolean
  canWithdraw: boolean
  /** Translated copy (t.events.teamJoin.*). Defaults keep legacy German call sites working. */
  labels?: TeamJoinLabels
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function call(method: string, path: string, body?: unknown): Promise<boolean> {
    setPending(true)
    setError(null)
    const res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    setPending(false)
    if (res.ok) {
      router.refresh()
      return true
    }
    setError(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? 'unknown')
    return false
  }

  const registrable = myTeams.filter((t) => t.isCaptain && !registeredTeamIds.includes(t.id))
  const incomplete = registrable.filter((t) => t.memberCount !== TEAM_SIZE)

  const copy: Record<string, string> = {
    registration_closed: labels.errorRegistrationClosed,
    team_incomplete: labels.errorTeamIncomplete,
    roster_full: labels.errorRosterFull,
    already_registered: labels.errorAlreadyRegistered,
    tournament_started: labels.errorTournamentStarted,
    bracket_exists: labels.errorBracketExists,
    forbidden: labels.errorForbidden,
  }

  return (
    <div className="space-y-3">
      {myEntry ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-x-cyan-text">
            {fill(labels.registered, { team: myEntry.teamName })}
          </span>
          {myEntry.checkedIn ? (
            <span className="text-sm text-current/60">{labels.checkedIn}</span>
          ) : checkInOpen && myEntry.viewerInLineup ? (
            <Button
              onClick={() => call('PATCH', `/api/tournaments/${tournamentId}/checkin`, { entryId: myEntry.entryId })}
              disabled={pending}
            >
              {labels.checkIn}
            </Button>
          ) : null}
          {canWithdraw && (
            <Button
              variant="secondary"
              onClick={() => call('DELETE', `/api/tournaments/${tournamentId}/team-entries/${myEntry.entryId}`)}
              disabled={pending}
            >
              {labels.withdraw}
            </Button>
          )}
        </div>
      ) : (
        <>
          {registrable
            .filter((t) => t.memberCount === TEAM_SIZE)
            .map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-3">
                <span className="text-sm">
                  {fill(labels.ready, { team: t.name, count: t.memberCount })}
                </span>
                <Button
                  onClick={() => call('POST', `/api/tournaments/${tournamentId}/team-entries`, { teamId: t.id })}
                  disabled={pending}
                >
                  {labels.register}
                </Button>
              </div>
            ))}
          {incomplete.map((t) => (
            <p key={t.id} className="text-sm text-current/60">
              „{t.name}“ {fill(labels.incompleteBefore, { count: t.memberCount })}{' '}
              <Link href={`/teams/${t.slug}`} className="text-x-cyan-text hover:underline">
                {labels.completeRoster}
              </Link>
              {labels.incompleteAfter}
            </p>
          ))}
          {myTeams.length === 0 && (
            <p className="text-sm text-current/60">
              {labels.noTeamsBefore}{' '}
              <Link href="/teams" className="text-x-cyan-text hover:underline">
                {labels.createTeam}
              </Link>{' '}
              {labels.noTeamsAfter}
            </p>
          )}
          {myTeams.length > 0 && registrable.length === 0 && !myEntry && (
            <p className="text-sm text-current/60">
              {labels.captainsOnly}
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-type-attack">
          {copy[error] ?? labels.errorGeneric}
        </p>
      )}
    </div>
  )
}
