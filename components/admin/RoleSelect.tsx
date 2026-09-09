// components/admin/RoleSelect.tsx
// Per-row role dropdown on the admin user list. PATCHes /api/admin/users/[id]/role and
// surfaces the result inline — the server is the authority (403 for non-admins can never
// occur here since the page itself is ADMIN-only, but errors still render via errorCopy).
'use client'

import { useState } from 'react'
import { Select } from '@/components/ui/Select'
import { errorMessage } from '@/lib/errorCopy'

const ROLES = [
  { value: 'GUEST', label: 'Gast' },
  { value: 'USER', label: 'Nutzer:in' },
  { value: 'TRUSTED', label: 'Vertrauensperson (Katalog)' },
  { value: 'JUDGE', label: 'Judge' },
  { value: 'ORGANIZER', label: 'Veranstalter:in' },
  { value: 'ADMIN', label: 'Admin' },
] as const

export function RoleSelect({ userId, currentRole }: { userId: string; currentRole: string }) {
  const [role, setRole] = useState(currentRole)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  async function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value
    setRole(next) // optimistic; rolled back on failure
    setPending(true)
    setFeedback(null)
    const res = await fetch(`/api/admin/users/${userId}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: next }),
    })
    setPending(false)
    if (res.ok) {
      setFeedback({ ok: true, text: 'Gespeichert.' })
    } else {
      setRole(currentRole)
      const body = await res.json().catch(() => null)
      setFeedback({ ok: false, text: errorMessage(body?.error ?? 'unknown') })
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={role} onChange={onChange} disabled={pending} aria-label="Rolle ändern" className="w-48">
        {ROLES.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </Select>
      {feedback && (
        <span role={feedback.ok ? 'status' : 'alert'} className={`text-xs ${feedback.ok ? 'text-current/60' : 'text-type-attack'}`}>
          {feedback.text}
        </span>
      )}
    </div>
  )
}
