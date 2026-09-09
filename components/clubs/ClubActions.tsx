// components/clubs/ClubActions.tsx
// Client-side membership operations for the club detail page, each hitting
// /api/clubs/[slug]/members: join (POST), leave/kick (DELETE), promote/demote (PATCH).
// Server-side authz decides; this component only offers the buttons that COULD succeed for
// the viewer's known state (member, admin, owner) and surfaces errors via errorCopy.
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { errorMessage } from '@/lib/errorCopy'

export interface ClubMemberRow {
  userId: string
  username: string
  displayName: string | null
  isAdmin: boolean
  isOwner: boolean
}

export interface ViewerState {
  userId: string | null // session user id (null for guests — then only the read-only roster renders)
  isMember: boolean
  canManage: boolean // member AND (owner or isAdmin) — the promote/demote/kick capability
}

export function ClubActions({ slug, viewer, members }: { slug: string; viewer: ViewerState; members: ClubMemberRow[] }) {
  const router = useRouter()
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function call(key: string, init: RequestInit) {
    setPending(key)
    setError(null)
    const res = await fetch(`/api/clubs/${encodeURIComponent(slug)}/members`, {
      ...init,
      headers: { 'Content-Type': 'application/json' },
    })
    setPending(null)
    if (res.ok || res.status === 204) {
      router.refresh()
    } else {
      const body = res.status === 204 ? null : await res.json().catch(() => null)
      setError(errorMessage(body?.error ?? 'unknown'))
    }
  }

  const join = () => call('join', { method: 'POST', body: '{}' })
  const remove = (userId: string) => call(`remove:${userId}`, { method: 'DELETE', body: JSON.stringify({ userId }) })
  const setAdmin = (userId: string, isAdmin: boolean) =>
    call(`admin:${userId}:${isAdmin}`, { method: 'PATCH', body: JSON.stringify({ userId, isAdmin }) })

  return (
    <div className="space-y-4">
      {viewer.userId && !viewer.isMember && (
        <Button onClick={join} disabled={pending !== null}>
          {pending === 'join' ? 'Tritt bei…' : 'Club beitreten'}
        </Button>
      )}

      <ul className="space-y-2">
        {members.map((m) => {
          const isSelf = m.userId === viewer.userId
          return (
            <li key={m.userId} className="flex flex-wrap items-center gap-2 rounded-md border border-x-cyan/20 px-3 py-2">
              <span className="font-medium">{m.displayName ?? m.username}</span>
              <span className="text-sm text-current/60">@{m.username}</span>
              {m.isOwner && <Badge tone="cyan">Inhaber:in</Badge>}
              {m.isAdmin && !m.isOwner && <Badge tone="green">Admin</Badge>}

              {/* No row actions on the viewer's own row (self-leave is the button below) nor
                  on the owner's row (ownership transfer is out of scope for Phase 4). */}
              {viewer.canManage && !isSelf && !m.isOwner && (
                <span className="ml-auto flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setAdmin(m.userId, !m.isAdmin)} disabled={pending !== null}>
                    {m.isAdmin ? 'Zurückstufen' : 'Zum Admin machen'}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => remove(m.userId)} disabled={pending !== null}>
                    Entfernen
                  </Button>
                </span>
              )}
            </li>
          )
        })}
      </ul>

      {viewer.userId && viewer.isMember && (
        <Button variant="secondary" onClick={() => remove(viewer.userId!)} disabled={pending !== null}>
          {pending?.startsWith('remove:') ? 'Verlasse…' : 'Club verlassen'}
        </Button>
      )}

      {error && (
        <p role="alert" className="text-sm text-type-attack">
          {error}
        </p>
      )}
    </div>
  )
}
