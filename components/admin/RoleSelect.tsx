// components/admin/RoleSelect.tsx
// Per-row role controls on the admin user list. PATCHes /api/admin/users/[id]/role and surfaces
// the result inline — the server is the authority (403 for non-admins can never occur here since
// the page itself is ADMIN-only, but errors still render via errorCopy). Issue #199 follow-up:
// Judge and Organizer are additive capabilities (User.isJudge/isOrganizer), independent of the
// GUEST/USER/TRUSTED/ADMIN trust-tier dropdown — rendered as separate checkboxes so any
// combination (e.g. TRUSTED + Judge + Organizer) is expressible.
'use client'

import { useState } from 'react'
import { Select } from '@/components/ui/Select'
import { errorMessage } from '@/lib/errorCopy'

const ROLES = [
  { value: 'GUEST', label: 'Gast' },
  { value: 'USER', label: 'Nutzer:in' },
  { value: 'TRUSTED', label: 'Vertrauensperson (Katalog)' },
  { value: 'ADMIN', label: 'Admin' },
] as const

export function RoleSelect({
  userId,
  currentRole,
  currentIsJudge,
  currentIsOrganizer,
}: {
  userId: string
  currentRole: string
  currentIsJudge: boolean
  currentIsOrganizer: boolean
}) {
  const [role, setRole] = useState(currentRole)
  const [isJudge, setIsJudge] = useState(currentIsJudge)
  const [isOrganizer, setIsOrganizer] = useState(currentIsOrganizer)
  const [pending, setPending] = useState(false)
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null)

  async function patch(body: Record<string, unknown>, rollback: () => void) {
    setPending(true)
    setFeedback(null)
    const res = await fetch(`/api/admin/users/${userId}/role`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setPending(false)
    if (res.ok) {
      setFeedback({ ok: true, text: 'Gespeichert.' })
    } else {
      rollback()
      const errBody = await res.json().catch(() => null)
      setFeedback({ ok: false, text: errorMessage(errBody?.error ?? 'unknown') })
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Select
        value={role}
        onChange={(e) => {
          const next = e.target.value
          setRole(next) // optimistic; rolled back on failure
          void patch({ role: next }, () => setRole(currentRole))
        }}
        disabled={pending}
        aria-label="Rolle ändern"
        className="w-48"
      >
        {ROLES.map((r) => (
          <option key={r.value} value={r.value}>
            {r.label}
          </option>
        ))}
      </Select>
      <label className="flex items-center gap-1 text-sm">
        <input
          type="checkbox"
          checked={isJudge}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.checked
            setIsJudge(next)
            void patch({ isJudge: next }, () => setIsJudge(currentIsJudge))
          }}
        />
        Judge
      </label>
      <label className="flex items-center gap-1 text-sm">
        <input
          type="checkbox"
          checked={isOrganizer}
          disabled={pending}
          onChange={(e) => {
            const next = e.target.checked
            setIsOrganizer(next)
            void patch({ isOrganizer: next }, () => setIsOrganizer(currentIsOrganizer))
          }}
        />
        Veranstalter:in
      </label>
      {feedback && (
        <span role={feedback.ok ? 'status' : 'alert'} className={`text-xs ${feedback.ok ? 'text-current/60' : 'text-type-attack'}`}>
          {feedback.text}
        </span>
      )}
    </div>
  )
}
