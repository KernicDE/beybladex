// components/tournament/SelfCheckinButton.tsx (Phase 7, item 2)
// Client button for the QR self-service check-in page: calls the existing
// PATCH /api/tournaments/[id]/checkin, forwarding the token so the route can verify it
// still matches Tournament.checkInToken (see that route's header comment).
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { errorMessage } from '@/lib/errorCopy'

export function SelfCheckinButton({
  tournamentId,
  token,
  alreadyCheckedIn,
  entryId,
}: {
  tournamentId: string
  token: string
  alreadyCheckedIn: boolean
  /** RC15 #12 — team mode: check-in targets the team ENTRY (any lineup member may check the team in). */
  entryId?: string
}) {
  const router = useRouter()
  const [done, setDone] = useState(alreadyCheckedIn)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function checkIn() {
    setPending(true)
    setError(null)
    const res = await fetch(`/api/tournaments/${tournamentId}/checkin`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ t: token, ...(entryId !== undefined ? { entryId } : {}) }),
    })
    setPending(false)
    if (res.ok) {
      setDone(true)
      router.refresh()
    } else {
      setError(errorMessage((await res.json().catch(() => null))?.error ?? 'unknown'))
    }
  }

  if (done) {
    return <p role="status" className="text-sm text-type-balance">Eingecheckt — viel Erfolg beim Turnier!</p>
  }

  return (
    <div className="space-y-2">
      <Button onClick={checkIn} disabled={pending}>
        {pending ? 'Checke ein…' : 'Jetzt einchecken'}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-type-attack">
          {error}
        </p>
      )}
    </div>
  )
}
