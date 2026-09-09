// components/social/FriendButton.tsx (Phase 4)
// The friend-request action for a foreign profile. The server passes the CURRENT friendship
// row (if any) as `initial`; this component only owns the transitions and re-derives its
// state from the API responses. Rendered only for logged-in, non-owner viewers — guests and
// the profile owner never see it.
'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'

export type FriendButtonState = {
  friendshipId: string | null
  status: 'PENDING' | 'ACCEPTED' | 'BLOCKED' | null
  /** true when the VIEWER is the requester of the pending row (outgoing request). */
  outgoing: boolean
}

export function FriendButton({ subjectId, initial }: { subjectId: string; initial: FriendButtonState }) {
  const [state, setState] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function call(input: RequestInfo, init: RequestInit, next: (body: Record<string, unknown>) => FriendButtonState) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(input, { ...init, headers: { 'content-type': 'application/json' } })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error === 'already_exists' ? 'Es besteht bereits eine Anfrage oder Freundschaft.' : 'Aktion fehlgeschlagen.')
        return
      }
      setState(next(await res.json()))
    } catch {
      setError('Netzwerkfehler.')
    } finally {
      setBusy(false)
    }
  }

  const send = () =>
    call('/api/friends', { method: 'POST', body: JSON.stringify({ addresseeId: subjectId }) }, (body) => ({
      friendshipId: typeof body.id === 'string' ? body.id : null,
      status: 'PENDING',
      outgoing: true,
    }))
  const accept = () =>
    state.friendshipId &&
    call(`/api/friends/${state.friendshipId}`, { method: 'PATCH', body: JSON.stringify({ action: 'accept' }) }, () => ({
      friendshipId: state.friendshipId, status: 'ACCEPTED', outgoing: false,
    }))
  const remove = () =>
    state.friendshipId &&
    call(`/api/friends/${state.friendshipId}`, { method: 'DELETE' }, () => ({ friendshipId: null, status: null, outgoing: false }))

  let content: React.ReactNode
  if (state.status === null) {
    content = (
      <Button onClick={send} disabled={busy}>Anfrage senden</Button>
    )
  } else if (state.status === 'PENDING' && state.outgoing) {
    content = (
      <>
        <Button variant="secondary" disabled>Angefragt</Button>
        <Button variant="ghost" size="sm" onClick={remove} disabled={busy}>Anfrage zurückziehen</Button>
      </>
    )
  } else if (state.status === 'PENDING') {
    content = (
      <>
        <Button onClick={accept} disabled={busy}>Annehmen</Button>
        <Button variant="secondary" onClick={remove} disabled={busy}>Ablehnen</Button>
      </>
    )
  } else if (state.status === 'ACCEPTED') {
    content = (
      <>
        <Button variant="secondary" disabled>Befreundet</Button>
        <Button variant="ghost" size="sm" onClick={remove} disabled={busy}>Entfreunden</Button>
      </>
    )
  } else {
    // BLOCKED — by either side. Deliberately no unblock action from here ([REVIEW-FIX] guard
    // against the blocked party probing); the row can only be removed by a party via the API.
    content = <Button variant="secondary" disabled>Blockiert</Button>
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {content}
      {error && <p className="text-sm text-type-attack" role="alert">{error}</p>}
    </div>
  )
}
