// components/admin/PartRequestQueue.tsx
// The "request missing part" admin queue: pending requests with a Resolve/Reject action each
// (PATCH /api/admin/part-requests — TRUSTED/ADMIN-only server-side). Rendered on
// app/settings/admin/parts below the catalog list.
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { MarkdownContent } from '@/components/ui/MarkdownContent'

interface QueueEntry {
  id: string
  name: string
  manufacturerGuess: string | null
  notes: string | null
  requestedBy: { username: string }
  createdAt: string
}

export function PartRequestQueue({ entries }: { entries: QueueEntry[] }) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)

  async function settle(id: string, status: 'RESOLVED' | 'REJECTED') {
    setBusyId(id)
    await fetch('/api/admin/part-requests', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    })
    setBusyId(null)
    router.refresh()
  }

  return (
    <ul className="divide-y rounded-xl border">
      {entries.map((entry) => (
        <li key={entry.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="font-medium">{entry.name}</p>
            <p className="text-sm text-current/60">
              von @{entry.requestedBy.username}
              {entry.manufacturerGuess && <> · Vermutung: {entry.manufacturerGuess === 'TT' ? 'Takara Tomy' : 'Hasbro'}</>}
            </p>
            {entry.notes && <MarkdownContent className="text-sm text-current/60">{entry.notes}</MarkdownContent>}
          </div>
          <Badge tone="cyan">Ausstehend</Badge>
          <Button size="sm" disabled={busyId === entry.id} onClick={() => settle(entry.id, 'RESOLVED')}>
            Aufgelöst
          </Button>
          <Button size="sm" variant="secondary" disabled={busyId === entry.id} onClick={() => settle(entry.id, 'REJECTED')}>
            Ablehnen
          </Button>
        </li>
      ))}
    </ul>
  )
}
