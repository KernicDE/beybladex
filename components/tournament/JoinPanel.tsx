// components/tournament/JoinPanel.tsx
// Client-side join / check-in / withdraw controls for the public event detail page. Guests never
// reach this component — the page renders the sign-in prompt for them per Task 13's
// anonymous-vs-member convention. Deck selection at join time is still not offered here
// — the API accepts an optional deckId (POST/PATCH /api/tournaments/[id]/join), but there is no
// picker yet: TODO(RC-folge): join-time deck picker.
// RC14-Nachzügler #130 — copy comes from the request dictionary via the optional `labels` prop
// (German defaults keep not-yet-translated call sites working).
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'

export interface JoinPanelLabels {
  joinNow: string
  joinedInfo: string
  checkedInInfo: string
  checkInNow: string
  withdraw: string
  errorAlreadyJoined: string
  errorGeneric: string
}

const DEFAULT_LABELS: JoinPanelLabels = {
  joinNow: 'Jetzt anmelden',
  joinedInfo: 'Du bist angemeldet.',
  checkedInInfo: 'Eingecheckt.',
  checkInNow: 'Jetzt einchecken',
  withdraw: 'Abmelden',
  errorAlreadyJoined: 'Du bist bereits angemeldet.',
  errorGeneric: 'Das hat leider nicht geklappt. Bitte versuche es erneut.',
}

export interface JoinPanelProps {
  tournamentId: string
  joined: boolean
  checkedIn: boolean
  /** True while the tournament's startDate is within the same-day check-in window. */
  checkInOpen: boolean
  /** True before the tournament's startDate — withdraw and deck edits are still allowed. */
  canWithdraw: boolean
  /** Translated copy (t.events.join.*). Defaults keep legacy German call sites working. */
  labels?: JoinPanelLabels
}

export function JoinPanel({ tournamentId, joined, checkedIn, checkInOpen, canWithdraw, labels = DEFAULT_LABELS }: JoinPanelProps) {
  const router = useRouter()
  const [state, setState] = useState({ joined, checkedIn })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function call(method: string, path: string) {
    setPending(true)
    setError(null)
    const res = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(method === 'POST' || method === 'PATCH' ? { body: '{}' } : {}),
    })
    setPending(false)
    if (res.ok) return true
    setError((await res.json().catch(() => null))?.error ?? 'unknown')
    return false
  }

  async function join() {
    if (await call('POST', `/api/tournaments/${tournamentId}/join`)) {
      setState((s) => ({ ...s, joined: true }))
      router.refresh()
    }
  }

  async function withdraw() {
    if (await call('DELETE', `/api/tournaments/${tournamentId}/join`)) {
      setState((s) => ({ ...s, joined: false, checkedIn: false }))
      router.refresh()
    }
  }

  async function checkIn() {
    if (await call('PATCH', `/api/tournaments/${tournamentId}/checkin`)) {
      setState((s) => ({ ...s, checkedIn: true }))
      router.refresh()
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {!state.joined ? (
        <Button onClick={join} disabled={pending}>
          {labels.joinNow}
        </Button>
      ) : (
        <>
          <span className="text-sm font-medium text-x-cyan-text">{labels.joinedInfo}</span>
          {state.checkedIn ? (
            <span className="text-sm text-current/60">{labels.checkedInInfo}</span>
          ) : checkInOpen ? (
            <Button onClick={checkIn} disabled={pending}>
              {labels.checkInNow}
            </Button>
          ) : null}
          {canWithdraw && (
            <Button variant="secondary" onClick={withdraw} disabled={pending}>
              {labels.withdraw}
            </Button>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-type-attack">
          {error === 'already_joined'
            ? labels.errorAlreadyJoined
            : labels.errorGeneric}
        </p>
      )}
    </div>
  )
}
