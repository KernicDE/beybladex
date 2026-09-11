// app/notifications/page.tsx (Phase 3)
// Notification inbox: paginated list (GET /api/notifications, take: 50 + cursor), unread
// counts, "alle als gelesen markieren" bulk action (PATCH { markAllRead: true }; individual
// rows use PATCH { ids: [id] } — the two accepted PATCH shapes), and live updates prepended
// from the SSE stream (EventSource → /api/notifications/stream?since=<newest seen>).
//
// (The unread count is wired into the Header's bell badge since RC10 #26 — the root
// layout queries it server-side and passes it into components/layout/Header.tsx.)
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'

interface NotificationItem {
  id: string
  title: string
  message: string
  link: string | null
  isRead: boolean
  createdAt: string
}

export default function NotificationsPage() {
  const [items, setItems] = useState<NotificationItem[] | null>(null)
  const [ready, setReady] = useState(false)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [unauthorized, setUnauthorized] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)
  // Newest createdAt seen, captured when the first page loads; the SSE connection is
  // opened with ?since=<this> so a reconnect replays anything missed while disconnected.
  const sinceRef = useRef<string | null>(null)

  const load = useCallback(async (cursor: string | null) => {
    const res = await fetch(`/api/notifications${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`)
    if (res.status === 401) {
      setUnauthorized(true)
      return null
    }
    if (!res.ok) return null
    return (await res.json()) as { notifications: NotificationItem[]; nextCursor: string | null }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function run() {
      const page = await load(null)
      if (cancelled) return
      sinceRef.current = page?.notifications[0]?.createdAt ?? null
      setItems(page?.notifications ?? [])
      setNextCursor(page?.nextCursor ?? null)
      setReady(true)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [load])

  // Live updates: the default EventSource reconnect reuses the original `since`, and the
  // server replays anything missed (bounded to 200 rows) — no custom backoff needed.
  useEffect(() => {
    if (!ready || unauthorized) return
    const since = sinceRef.current
    const source = new EventSource(`/api/notifications/stream${since ? `?since=${encodeURIComponent(since)}` : ''}`)
    source.onmessage = (event) => {
      try {
        const incoming = JSON.parse(event.data) as NotificationItem
        setItems((current) => {
          if (!current || current.some((n) => n.id === incoming.id)) return current
          return [incoming, ...current]
        })
      } catch {
        // ignore malformed events
      }
    }
    return () => source.close()
  }, [ready, unauthorized])

  const loadMore = async () => {
    if (!nextCursor) return
    setLoadingMore(true)
    const page = await load(nextCursor)
    setLoadingMore(false)
    if (!page) return
    setItems((current) => [...(current ?? []), ...page.notifications.filter((n) => !current?.some((c) => c.id === n.id))])
    setNextCursor(page.nextCursor)
  }

  const markRead = async (id: string) => {
    const res = await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [id] }),
    })
    if (res.ok) {
      setItems((current) => current?.map((n) => (n.id === id ? { ...n, isRead: true } : n)) ?? [])
    }
  }

  const markAllRead = async () => {
    setMarkingAll(true)
    const res = await fetch('/api/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markAllRead: true }),
    })
    setMarkingAll(false)
    if (res.ok) {
      setItems((current) => current?.map((n) => ({ ...n, isRead: true })) ?? [])
    }
  }

  const unreadCount = items?.filter((n) => !n.isRead).length ?? 0

  if (unauthorized) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
        <h1 className="text-2xl font-semibold">Benachrichtigungen</h1>
        <EmptyState
          title="Anmeldung erforderlich"
          description="Dein Benachrichtigungs-Eingang gehört zu deinem Konto."
          action={
            <Link href="/login" className="rounded-md bg-x-cyan px-4 py-2 text-sm font-medium text-base-dark transition-colors hover:bg-x-cyan/85">
              Anmelden, um fortzufahren
            </Link>
          }
        />
      </main>
    )
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="flex items-center gap-3 text-2xl font-semibold">
          Benachrichtigungen
          {unreadCount > 0 && <Badge tone="cyan">{unreadCount} ungelesen</Badge>}
        </h1>
        {unreadCount > 0 && (
          <Button variant="secondary" size="sm" onClick={markAllRead} disabled={markingAll}>
            {markingAll ? 'Markiere…' : 'Alle als gelesen markieren'}
          </Button>
        )}
      </div>

      {items === null ? (
        <p className="text-sm text-current/60">Lade…</p>
      ) : items.length === 0 ? (
        <EmptyState
          title="Noch keine Benachrichtigungen"
          description="Wenn ein Turnier in deinem Suchradius angekündigt wird, erscheint es hier."
        />
      ) : (
        <ul className="space-y-3">
          {items.map((n) => (
            <li key={n.id}>
              <Card className={`p-4 ${n.isRead ? 'opacity-70' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {!n.isRead && <span className="sr-only">Ungelesen: </span>}
                      {n.title}
                    </p>
                    <p className="text-sm text-current/70">{n.message}</p>
                    <p className="mt-1 text-xs text-current/50">
                      {new Date(n.createdAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {n.link && (
                      <Link href={n.link} className="text-sm text-x-cyan-text underline dark:text-x-cyan">
                        Ansehen
                      </Link>
                    )}
                    {!n.isRead && (
                      <Button variant="ghost" size="sm" onClick={() => markRead(n.id)}>
                        Als gelesen markieren
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {nextCursor && (
        <div className="text-center">
          <Button variant="secondary" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Lade…' : 'Weitere laden'}
          </Button>
        </div>
      )}
    </main>
  )
}
