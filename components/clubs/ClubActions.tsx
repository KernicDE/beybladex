// components/clubs/ClubActions.tsx
// Client-side membership operations for the club detail page, each hitting
// /api/clubs/[slug]/members: join/apply/invite (POST), leave/kick/reject/rescind/decline
// (DELETE), promote/demote + approve/accept (PATCH). Phase 13 makes the actions join-policy
// aware: OPEN joins immediately, APPLICATION sends a request, INVITE_ONLY offers no
// self-service join at all — instead admins get an invite-by-username flow (reusing the
// Phase 4 user search) and a pending applications/invites list to act on.
// Server-side authz decides; this component only offers the buttons that COULD succeed for
// the viewer's known state and surfaces errors via errorCopy.
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { errorMessage } from '@/lib/errorCopy'

export interface ClubMemberRow {
  userId: string
  username: string
  displayName: string | null
  isAdmin: boolean
  isOwner: boolean
}

export type MembershipStatus = 'NONE' | 'ACTIVE' | 'PENDING_APPLICATION' | 'PENDING_INVITE'

export interface PendingMemberRow {
  userId: string
  username: string
  displayName: string | null
  status: 'PENDING_APPLICATION' | 'PENDING_INVITE'
}

export interface ViewerState {
  userId: string | null // session user id (null for guests — then only the read-only roster renders)
  membershipStatus: MembershipStatus
  canManage: boolean // ACTIVE member AND (owner or isAdmin) — the promote/demote/kick/approve capability
}

interface SearchUser {
  id: string
  username: string
  displayName: string | null
}

export function ClubActions({
  slug,
  joinPolicy,
  viewer,
  members,
  pending,
}: {
  slug: string
  joinPolicy: string
  viewer: ViewerState
  members: ClubMemberRow[]
  pending: PendingMemberRow[]
}) {
  const router = useRouter()
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [inviteQuery, setInviteQuery] = useState('')
  const [inviteResults, setInviteResults] = useState<SearchUser[] | null>(null)

  async function call(key: string, init: RequestInit) {
    setPendingKey(key)
    setError(null)
    const res = await fetch(`/api/clubs/${encodeURIComponent(slug)}/members`, {
      ...init,
      headers: { 'Content-Type': 'application/json' },
    })
    setPendingKey(null)
    if (res.ok || res.status === 204) {
      router.refresh()
    } else {
      const body = res.status === 204 ? null : await res.json().catch(() => null)
      setError(errorMessage(body?.error ?? 'unknown'))
    }
  }

  const join = () => call('join', { method: 'POST', body: '{}' })
  const invite = (userId: string) => call(`invite:${userId}`, { method: 'POST', body: JSON.stringify({ userId }) })
  const approve = (userId: string) => call(`approve:${userId}`, { method: 'PATCH', body: JSON.stringify({ userId, action: 'approve' }) })
  const acceptInvite = () => viewer.userId && call('accept', { method: 'PATCH', body: JSON.stringify({ userId: viewer.userId, action: 'accept' }) })
  const remove = (userId: string) => call(`remove:${userId}`, { method: 'DELETE', body: JSON.stringify({ userId }) })
  const setAdmin = (userId: string, isAdmin: boolean) =>
    call(`admin:${userId}:${isAdmin}`, { method: 'PATCH', body: JSON.stringify({ userId, isAdmin }) })

  async function searchInvitees(e: React.FormEvent) {
    e.preventDefault()
    const q = inviteQuery.trim()
    if (!q) return
    setPendingKey('invite-search')
    setError(null)
    const res = await fetch(`/api/search/users?q=${encodeURIComponent(q)}&take=8`)
    setPendingKey(null)
    if (res.ok) {
      const body = await res.json()
      setInviteResults(body.users ?? [])
    } else {
      setInviteResults([])
    }
  }

  const busy = pendingKey !== null
  const applications = pending.filter((p) => p.status === 'PENDING_APPLICATION')
  const invites = pending.filter((p) => p.status === 'PENDING_INVITE')

  return (
    <div className="space-y-4">
      {/* Self-service action, per join policy. INVITE_ONLY shows no join button at all. */}
      {viewer.userId && viewer.membershipStatus === 'NONE' && joinPolicy === 'OPEN' && (
        <Button onClick={join} disabled={busy}>
          {pendingKey === 'join' ? 'Tritt bei…' : 'Club beitreten'}
        </Button>
      )}
      {viewer.userId && viewer.membershipStatus === 'NONE' && joinPolicy === 'APPLICATION' && (
        <Button onClick={join} disabled={busy}>
          {pendingKey === 'join' ? 'Sende…' : 'Bewerbung senden'}
        </Button>
      )}
      {viewer.userId && viewer.membershipStatus === 'NONE' && joinPolicy === 'INVITE_ONLY' && (
        <p className="text-sm text-current/60">Dieser Club ist nur auf Einladung beitretbar.</p>
      )}
      {viewer.userId && viewer.membershipStatus === 'PENDING_APPLICATION' && (
        <p className="text-sm text-current/60">Deine Bewerbung ist ausstehend — sie muss noch von einer Admin oder dem Inhaber genehmigt werden.</p>
      )}
      {viewer.userId && viewer.membershipStatus === 'PENDING_INVITE' && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">Du bist eingeladen.</span>
          <Button size="sm" onClick={acceptInvite} disabled={busy}>
            {pendingKey === 'accept' ? 'Nehme an…' : 'Einladung annehmen'}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => viewer.userId && remove(viewer.userId)} disabled={busy}>
            Ablehnen
          </Button>
        </div>
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
                  on the owner's row (ownership transfer is out of scope). */}
              {viewer.canManage && !isSelf && !m.isOwner && (
                <span className="ml-auto flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setAdmin(m.userId, !m.isAdmin)} disabled={busy}>
                    {m.isAdmin ? 'Zurückstufen' : 'Zum Admin machen'}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => remove(m.userId)} disabled={busy}>
                    Entfernen
                  </Button>
                </span>
              )}
            </li>
          )
        })}
      </ul>

      {viewer.userId && viewer.membershipStatus === 'ACTIVE' && (
        <Button variant="secondary" onClick={() => viewer.userId && remove(viewer.userId!)} disabled={busy}>
          {pendingKey?.startsWith('remove:') ? 'Verlasse…' : 'Club verlassen'}
        </Button>
      )}

      {/* Admin area: pending applications & invites (Phase 13). */}
      {viewer.canManage && (applications.length > 0 || invites.length > 0) && (
        <section aria-label="Offene Bewerbungen und Einladungen" className="space-y-2 rounded-md border border-x-cyan/20 p-3">
          <h3 className="text-sm font-semibold">Offene Bewerbungen & Einladungen</h3>
          <ul className="space-y-2">
            {applications.map((p) => (
              <li key={p.userId} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.displayName ?? p.username}</span>
                <span className="text-sm text-current/60">@{p.username}</span>
                <Badge tone="neutral">Bewerbung</Badge>
                <span className="ml-auto flex gap-2">
                  <Button size="sm" onClick={() => approve(p.userId)} disabled={busy}>
                    Genehmigen
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => remove(p.userId)} disabled={busy}>
                    Ablehnen
                  </Button>
                </span>
              </li>
            ))}
            {invites.map((p) => (
              <li key={p.userId} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.displayName ?? p.username}</span>
                <span className="text-sm text-current/60">@{p.username}</span>
                <Badge tone="neutral">Eingeladen</Badge>
                <span className="ml-auto">
                  <Button size="sm" variant="danger" onClick={() => remove(p.userId)} disabled={busy}>
                    Zurückziehen
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Admin invite-by-username flow (Phase 4 user search infrastructure). */}
      {viewer.canManage && (
        <section aria-label="Mitglied einladen" className="space-y-2">
          <h3 className="text-sm font-semibold">Mitglied einladen</h3>
          <form onSubmit={searchInvitees} className="flex gap-2">
            <Input
              value={inviteQuery}
              onChange={(e) => setInviteQuery(e.target.value)}
              placeholder="Benutzername suchen…"
              aria-label="Benutzername suchen"
            />
            <Button type="submit" variant="secondary" disabled={busy || inviteQuery.trim().length === 0}>
              Suchen
            </Button>
          </form>
          {inviteResults !== null && (
            <ul className="space-y-1">
              {inviteResults.length === 0 && <li className="text-sm text-current/60">Keine Nutzer:innen gefunden.</li>}
              {inviteResults.map((u) => (
                <li key={u.id} className="flex items-center gap-2">
                  <span className="font-medium">{u.displayName ?? u.username}</span>
                  <span className="text-sm text-current/60">@{u.username}</span>
                  <span className="ml-auto">
                    <Button size="sm" onClick={() => invite(u.id)} disabled={busy}>
                      {pendingKey === `invite:${u.id}` ? 'Lade ein…' : 'Einladen'}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {error && (
        <p role="alert" className="text-sm text-type-attack">
          {error}
        </p>
      )}
    </div>
  )
}
