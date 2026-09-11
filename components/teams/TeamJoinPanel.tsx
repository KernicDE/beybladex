// components/teams/TeamJoinPanel.tsx (RC15, issue #12)
// Client-side TEAM registration / check-in / withdrawal controls for the public event detail
// page of a team-mode tournament. AUTHZ (server-enforced, this is the UX): only a team's
// CAPTAIN may register or withdraw it; any lineup member may check the team in (self-service,
// same idea as the solo "Jetzt einchecken" button). Teams register ROSTER-COMPLETE only — the
// button only appears for the viewer's captain teams that already have exactly 3 members;
// incomplete rosters get an actionable hint instead of a dead button.
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { TEAM_SIZE } from '@/lib/teams'

export interface MyTeamInfo {
  id: string
  name: string
  slug: string
  memberCount: number
  isCaptain: boolean
}

export function TeamJoinPanel({
  tournamentId,
  myTeams,
  registeredTeamIds,
  myEntry,
  checkInOpen,
  canWithdraw,
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
    registration_closed: 'Die Anmeldung ist geschlossen.',
    team_incomplete: 'Das Team braucht genau 3 Mitglieder für die Anmeldung.',
    roster_full: 'Das Team hat mehr als 3 Mitglieder — für 3-gegen-3 muss der Roster passen.',
    already_registered: 'Ein Mitglied ist bereits mit einem anderen Team angemeldet.',
    tournament_started: 'Das Turnier hat bereits begonnen.',
    bracket_exists: 'Der Turnierbaum ist bereits erzeugt — Abmeldung ist nicht mehr möglich.',
    forbidden: 'Nur die Team-Captain:innen können das Team (ab)melden.',
  }

  return (
    <div className="space-y-3">
      {myEntry ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-x-cyan-text">
            Dein Team „{myEntry.teamName}“ ist angemeldet.
          </span>
          {myEntry.checkedIn ? (
            <span className="text-sm text-current/60">Eingecheckt.</span>
          ) : checkInOpen && myEntry.viewerInLineup ? (
            <Button
              onClick={() => call('PATCH', `/api/tournaments/${tournamentId}/checkin`, { entryId: myEntry.entryId })}
              disabled={pending}
            >
              Team einchecken
            </Button>
          ) : null}
          {canWithdraw && (
            <Button
              variant="secondary"
              onClick={() => call('DELETE', `/api/tournaments/${tournamentId}/team-entries/${myEntry.entryId}`)}
              disabled={pending}
            >
              Team abmelden
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
                  Dein Team „{t.name}“ ({t.memberCount}/3) ist startbereit.
                </span>
                <Button
                  onClick={() => call('POST', `/api/tournaments/${tournamentId}/team-entries`, { teamId: t.id })}
                  disabled={pending}
                >
                  Team anmelden
                </Button>
              </div>
            ))}
          {incomplete.map((t) => (
            <p key={t.id} className="text-sm text-current/60">
              „{t.name}“ hat {t.memberCount}/3 Mitgliedern —{' '}
              <a href={`/teams/${t.slug}`} className="text-x-cyan-text hover:underline">
                Roster vervollständigen
              </a>
              , um das Team anzumelden.
            </p>
          ))}
          {myTeams.length === 0 && (
            <p className="text-sm text-current/60">
              Team-Turnier:{' '}
              <a href="/teams" className="text-x-cyan-text hover:underline">
                Gründe ein Team
              </a>{' '}
              mit genau 3 Mitgliedern, um teilzunehmen.
            </p>
          )}
          {myTeams.length > 0 && registrable.length === 0 && !myEntry && (
            <p className="text-sm text-current/60">
              Nur die Team-Captain:innen können ein Team anmelden.
            </p>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-type-attack">
          {copy[error] ?? 'Das hat leider nicht geklappt. Bitte versuche es erneut.'}
        </p>
      )}
    </div>
  )
}
