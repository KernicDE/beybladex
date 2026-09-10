// components/tournament/ArenaCheckinButton.tsx (Phase 7, item 3)
// Client button for the arena-station page: calls POST .../matches/[matchId]/arena-checkin.
// `canMark` gates rendering only — the route itself is the real authz boundary (self, or
// tournament staff marking on a player's behalf).
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { errorMessage } from '@/lib/errorCopy'

export function ArenaCheckinButton({
  tournamentId,
  matchId,
  playerId,
  isSelf,
  canMark,
  alreadyCheckedIn,
}: {
  tournamentId: string
  matchId: string
  playerId: string
  isSelf: boolean
  canMark: boolean
  alreadyCheckedIn: boolean
}) {
  const router = useRouter()
  const [done, setDone] = useState(alreadyCheckedIn)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function checkIn() {
    setPending(true)
    setError(null)
    const res = await fetch(`/api/tournaments/${tournamentId}/matches/${matchId}/arena-checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(isSelf ? {} : { userId: playerId }),
    })
    setPending(false)
    if (res.ok) {
      setDone(true)
      router.refresh()
    } else {
      setError(errorMessage((await res.json().catch(() => null))?.error ?? 'unknown'))
    }
  }

  if (done) return <span className="text-sm text-type-balance">✓ eingecheckt</span>
  if (!canMark) return <span className="text-sm text-current/50">wartet</span>

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" onClick={checkIn} disabled={pending}>
        {pending ? '…' : 'Einchecken'}
      </Button>
      {error && <span className="text-xs text-type-attack">{error}</span>}
    </div>
  )
}
