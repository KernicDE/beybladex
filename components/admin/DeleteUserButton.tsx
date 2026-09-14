// components/admin/DeleteUserButton.tsx (issue #185)
// Per-row "Konto löschen" action on the admin user list. window.confirm before the request —
// same established pattern as OrganizerConsole's irreversible actions (Turnier starten/
// absagen/abschließen). DELETEs /api/admin/users/[id], then router.refresh() so the row
// disappears (the account is anonymized in place, not literally removed from the table, but
// its username changes to the geloescht_* tombstone — refresh reflects that immediately).
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { errorMessage } from '@/lib/errorCopy'

export function DeleteUserButton({ userId, username }: { userId: string; username: string }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onClick() {
    if (!window.confirm(`Konto @${username} unwiderruflich löschen? Persönliche Daten werden entfernt, Turnier-/Club-Historie bleibt anonymisiert erhalten. Dies kann nicht rückgängig gemacht werden.`)) {
      return
    }
    setPending(true)
    setError(null)
    const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' })
    setPending(false)
    if (res.ok) {
      router.refresh()
    } else {
      const body = await res.json().catch(() => null)
      setError(errorMessage(body?.error ?? 'unknown'))
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="rounded-md border border-type-attack/40 px-3 py-1.5 text-xs font-medium text-type-attack transition-colors hover:bg-type-attack/10 disabled:opacity-50"
      >
        Konto löschen
      </button>
      {error && <span role="alert" className="text-xs text-type-attack">{error}</span>}
    </div>
  )
}
