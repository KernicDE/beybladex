// components/tournament/OrganizerConsole.tsx
// Phase 5 Part C — the operator surface for running a tournament ([REVIEW-FIX: ux-product §3f]:
// Match.status/round/bracketOrder existed with no operator UI at all). Visible ONLY to the
// tournament's creator or an ADMIN (enforced server-side on every action; the page additionally
// gates rendering). Actions: Bracket generieren (once, after check-in), Judge zuweisen per
// match, no-show handling (marks the participant withdrawn, auto-advances the opponent), and
// Turnier abschließen.
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { Card, CardTitle } from '@/components/ui/Card'

export type ConsoleParticipant = { userId: string; name: string; checkedIn: boolean; withdrawn: boolean }
export type ConsoleMatch = {
  id: string
  round: number
  label: string
  player1: string | null
  player2: string | null
  status: string
  judgeId: string | null
}
export type ConsoleJudge = { id: string; name: string }

export function OrganizerConsole({
  tournamentId,
  participants,
  matches,
  judges,
  bracketGenerated,
  completedAt,
}: {
  tournamentId: string
  participants: ConsoleParticipant[]
  matches: ConsoleMatch[]
  judges: ConsoleJudge[]
  bracketGenerated: boolean
  completedAt: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const base = `/api/tournaments/${tournamentId}`
  const call = async (fn: () => Promise<Response>, successMessage?: string) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fn()
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? `Fehler (${res.status})`)
      } else if (successMessage) {
        router.refresh()
      }
    } catch {
      setError('Netzwerkfehler — bitte erneut versuchen.')
    } finally {
      setBusy(false)
    }
  }

  const checkedIn = participants.filter((p) => p.checkedIn && !p.withdrawn)
  const openMatches = matches.filter((m) => m.status !== 'COMPLETED')
  const completed = completedAt !== null

  return (
    <Card className="space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Organisatoren-Konsole</CardTitle>
        {completed && <Badge tone="green">Turnier abgeschlossen</Badge>}
      </div>
      {error && <p role="alert" className="text-sm text-type-attack">{error}</p>}

      {!bracketGenerated && !completed && (
        <div className="space-y-2">
          <p className="text-sm text-current/70">
            {checkedIn.length} eingecheckte Teilnehmer. Der Bracket wird aus allen eingecheckten,
            nicht zurückgezogenen Teilnehmern erstellt (Freilose bei Teilnehmerzahlen ohne
            Zweierpotenz — Auslosung deterministisch nach Benutzername).
          </p>
          <Button
            disabled={busy || checkedIn.length < 2}
            onClick={() => call(() => fetch(`${base}/bracket`, { method: 'POST' }), 'ok')}
          >
            Bracket generieren
          </Button>
          {checkedIn.length < 2 && (
            <p className="text-xs text-current/50">Mindestens 2 eingecheckte Teilnehmer nötig.</p>
          )}
        </div>
      )}

      {bracketGenerated && !completed && (
        <>
          <section aria-labelledby="judge-assign-heading" className="space-y-2">
            <h3 id="judge-assign-heading" className="text-sm font-semibold">
              Judge zuweisen ({openMatches.length} offene Matches)
            </h3>
            <ul className="space-y-2">
              {matches.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center gap-2 rounded-md border border-current/10 px-3 py-2 text-sm">
                  <span className="min-w-40 flex-1">
                    <span className="text-current/50">{m.label}: </span>
                    {m.player1 ?? 'Offen'} vs. {m.player2 ?? 'Offen'}
                  </span>
                  <Select
                    aria-label={`Judge für ${m.player1 ?? 'Offen'} vs. ${m.player2 ?? 'Offen'}`}
                    defaultValue={m.judgeId ?? ''}
                    disabled={busy || m.status === 'COMPLETED'}
                    className="w-44"
                    onChange={(e) => {
                      const judgeId = e.target.value || null
                      void call(() =>
                        fetch(`${base}/matches/${m.id}/judge`, {
                          method: 'PATCH',
                          headers: { 'content-type': 'application/json' },
                          body: JSON.stringify({ judgeId }),
                        })
                      )
                    }}
                  >
                    <option value="">— kein Judge —</option>
                    {judges.map((j) => (
                      <option key={j.id} value={j.id}>
                        {j.name}
                      </option>
                    ))}
                  </Select>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="noshow-heading" className="space-y-2">
            <h3 id="noshow-heading" className="text-sm font-semibold">
              Nicht erschienen (No-Show)
            </h3>
            <ul className="space-y-1">
              {checkedIn.map((p) => (
                <li key={p.userId} className="flex items-center justify-between gap-2 text-sm">
                  <span>{p.name}</span>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`${p.name} als nicht erschienen markieren? Der Gegner wird automatisch weitergebracht.`)) {
                        void call(() =>
                          fetch(`${base}/noshow`, {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ userId: p.userId }),
                          })
                        )
                      }
                    }}
                  >
                    No-Show
                  </Button>
                </li>
              ))}
            </ul>
          </section>

          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              if (window.confirm('Turnier abschließen? Dies kann nicht rückgängig gemacht werden.')) {
                void call(() => fetch(`${base}/complete`, { method: 'POST' }), 'ok')
              }
            }}
          >
            Turnier abschließen
          </Button>
        </>
      )}
    </Card>
  )
}
