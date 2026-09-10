// components/clubs/ClubChat.tsx (Phase 12)
// Client-side club chat: initial load via GET /api/clubs/[slug]/messages (the up-to-50 buffer),
// then live updates over EventSource → /api/clubs/[slug]/messages/stream (server replays the
// full up-to-50 buffer on every reconnect, so the initial fetch and reconnect paths merge
// simply by de-duplicating on message id). Posting is plain text (Phase 12 decision while
// Phase 8's Markdown renderer doesn't exist yet — revisit once it lands). Auto-scrolls to the
// newest message whenever the list grows.
'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import { errorMessage } from '@/lib/errorCopy'

interface ChatMessage {
  id: string
  authorId: string
  authorName: string
  body: string
  createdAt: string
}

const BODY_MAX = 500

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
}

export function ClubChat({ slug, viewer }: { slug: string; viewer: { userId: string | null; canManage: boolean } }) {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null)
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unauthorized, setUnauthorized] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  const base = `/api/clubs/${encodeURIComponent(slug)}/messages`

  // Initial load: the GET returns the same up-to-50 buffer the SSE replays on reconnect —
  // messages arriving via the stream before the fetch resolves are de-duplicated by id.
  useEffect(() => {
    let cancelled = false
    fetch(base)
      .then(async (res) => {
        if (res.status === 401 || res.status === 403) {
          if (!cancelled) setUnauthorized(true)
          return
        }
        if (!res.ok) return
        const body = (await res.json()) as { messages: ChatMessage[] }
        if (!cancelled) setMessages((current) => merge(current ?? [], body.messages))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [base])

  // Live updates: default EventSource reconnect replays the full buffer — de-duplicated below.
  useEffect(() => {
    if (unauthorized) return
    const source = new EventSource(`${base}/stream`)
    source.onmessage = (event) => {
      try {
        const incoming = JSON.parse(event.data) as ChatMessage
        setMessages((current) => merge(current ?? [], [incoming]))
      } catch {
        // ignore malformed events
      }
    }
    return () => source.close()
  }, [base, unauthorized])

  // Auto-scroll to the newest message whenever the list grows.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  if (unauthorized) return null // non-members never see the chat surface (server-side 403 too)

  const send = async () => {
    const text = draft.trim()
    if (!text || pending) return
    setPending(true)
    setError(null)
    const res = await fetch(base, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: text }),
    })
    setPending(false)
    if (res.ok) {
      const body = (await res.json()) as { message: ChatMessage }
      setDraft('')
      setMessages((current) => merge(current ?? [], [body.message]))
    } else {
      const body = await res.json().catch(() => null)
      setError(errorMessage(body?.error ?? 'unknown'))
    }
  }

  const remove = async (messageId: string) => {
    setError(null)
    const res = await fetch(`${base}?messageId=${encodeURIComponent(messageId)}`, { method: 'DELETE' })
    if (res.ok) {
      setMessages((current) => (current ?? []).filter((m) => m.id !== messageId))
    } else {
      const body = await res.json().catch(() => null)
      setError(errorMessage(body?.error ?? 'unknown'))
    }
  }

  return (
    <div className="space-y-3">
      <div ref={listRef} className="max-h-96 space-y-2 overflow-y-auto rounded-md border border-x-cyan/20 p-3" aria-live="polite">
        {messages === null ? (
          <p className="text-sm text-current/60">Nachrichten werden geladen…</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-current/60">Noch keine Nachrichten — schreib die erste!</p>
        ) : (
          messages.map((m) => {
            const isSelf = m.authorId === viewer.userId
            const canDelete = isSelf || viewer.canManage
            return (
              <div key={m.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-medium">{m.authorName}</span>
                <span className="text-xs text-current/50">{formatTime(m.createdAt)}</span>
                <span className="basis-full whitespace-pre-wrap break-words text-sm">{m.body}</span>
                {canDelete && (
                  <Button size="sm" variant="danger" onClick={() => remove(m.id)}>
                    Löschen
                  </Button>
                )}
              </div>
            )
          })
        )}
      </div>

      <div className="space-y-2">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={BODY_MAX}
          rows={2}
          placeholder="Nachricht schreiben…"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <div className="flex items-center gap-3">
          <Button onClick={() => void send()} disabled={pending || draft.trim().length === 0}>
            {pending ? 'Sende…' : 'Senden'}
          </Button>
          <span className="text-xs text-current/50">
            {draft.length}/{BODY_MAX}
          </span>
        </div>
        {error && (
          <p role="alert" className="text-sm text-type-attack">
            {error}
          </p>
        )}
      </div>
    </div>
  )
}

// Merge a backfill/live batch into the current list, de-duplicated by id, oldest first,
// bounded to the 50-message cap the server enforces.
function merge(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const seen = new Set(current.map((m) => m.id))
  const merged = [...current, ...incoming.filter((m) => !seen.has(m.id))]
  return merged.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-50)
}
