// components/teams/TeamMembersPanel.tsx (RC15, issue #12)
// Roster management on /teams/[slug]. AUTHZ (enforced again server-side, this is the UX):
// - add-by-username: captains only, refused at 3 members (the roster IS the 3-vs-3 lineup).
// - remove: captains anyone; a plain member only themselves (leave).
// - role toggle (captain crown): captains only; the last captain cannot be demoted/removed.
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'

export interface TeamMemberRow {
  userId: string
  name: string
  role: 'CAPTAIN' | 'MEMBER'
}

export function TeamMembersPanel({
  slug,
  members,
  viewerId,
  viewerIsCaptain,
}: {
  slug: string
  members: TeamMemberRow[]
  viewerId: string
  viewerIsCaptain: boolean
}) {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function call(path: string, init: RequestInit): Promise<boolean> {
    setPending(true)
    setError(null)
    const res = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...init })
    setPending(false)
    if (res.ok) {
      router.refresh()
      return true
    }
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    setError(body?.error ?? 'unknown')
    return false
  }

  async function addMember(e: React.FormEvent) {
    e.preventDefault()
    if (await call(`/api/teams/${slug}/members`, { method: 'POST', body: JSON.stringify({ username }) })) {
      setUsername('')
    }
  }

  const copy: Record<string, string> = {
    roster_full: 'Das Team ist voll — ein 3-vs-3-Roster hat genau 3 Mitglieder.',
    user_not_found: 'Diese:n Nutzer:in gibt es nicht (genauer Benutzername).',
    already_member: 'Ist bereits im Team.',
    last_captain: 'Das Team braucht mindestens eine:n Captain.',
    forbidden: 'Dafür fehlt dir die Berechtigung.',
  }

  return (
    <section aria-labelledby="team-members-heading" className="space-y-3">
      <h2 id="team-members-heading" className="text-lg font-semibold">
        Roster ({members.length}/3)
      </h2>
      <ul className="space-y-2">
        {members.map((m) => (
          <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-current/10 px-3 py-2 text-sm">
            <span className="flex items-center gap-2">
              {m.name}
              {m.role === 'CAPTAIN' && <Badge tone="cyan">Captain</Badge>}
            </span>
            {(viewerIsCaptain || m.userId === viewerId) && !(members.length === 1 && m.userId === viewerId) && (
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() =>
                  call(`/api/teams/${slug}/members/${m.userId}`, {
                    method: 'DELETE',
                  })
                }
              >
                {m.userId === viewerId ? 'Verlassen' : 'Entfernen'}
              </Button>
            )}
          </li>
        ))}
      </ul>

      {viewerIsCaptain && (
        <form onSubmit={addMember} className="flex flex-wrap items-center gap-2">
          <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Benutzername hinzufügen…" className="w-56" />
          <Button type="submit" disabled={pending || members.length >= 3}>
            Hinzufügen
          </Button>
        </form>
      )}
      {!viewerIsCaptain && <p className="text-xs text-current/60">Nur die Team-Captain:innen können den Roster bearbeiten.</p>}
      {error && (
        <p role="alert" className="text-sm text-type-attack">
          {copy[error] ?? 'Das hat leider nicht geklappt. Bitte versuche es erneut.'}
        </p>
      )}
    </section>
  )
}
