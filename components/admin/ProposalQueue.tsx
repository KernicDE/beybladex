// components/admin/ProposalQueue.tsx (Phase 11, item 1)
// The catalog-proposal review queue — replaces PartRequestQueue. Approve/Reject each pending
// CatalogProposal (PATCH /api/admin/proposals — TRUSTED/JUDGE/ORGANIZER/ADMIN server-side).
// Rejecting requires a note (the route enforces this too); shown inline per entry.
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'

interface InlinePartLike {
  name: string
  manufacturer: 'TT' | 'HASBRO'
}
interface PartPayload extends InlinePartLike {
  category: string
}
interface BuildPayload {
  name: string
  slots: Record<'blade' | 'ratchet' | 'bit', { partId: string | null; inline: InlinePartLike | null }>
}

export interface ProposalEntry {
  id: string
  kind: 'PART' | 'BUILD'
  payload: PartPayload | BuildPayload
  imageAssetId: string | null
  submittedBy: string
  createdAt: string
}

function proposalLabel(entry: ProposalEntry): string {
  if (entry.kind === 'PART') return (entry.payload as PartPayload).name
  const build = entry.payload as BuildPayload
  return build.name
}

export function ProposalQueue({ entries }: { entries: ProposalEntry[] }) {
  const router = useRouter()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejectNoteFor, setRejectNoteFor] = useState<string | null>(null)
  const [note, setNote] = useState('')

  async function settle(id: string, status: 'APPROVED' | 'REJECTED', reviewNote?: string) {
    setBusyId(id)
    const res = await fetch('/api/admin/proposals', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status, reviewNote }),
    })
    setBusyId(null)
    if (res.ok) {
      setRejectNoteFor(null)
      setNote('')
      router.refresh()
    }
  }

  return (
    <ul className="divide-y rounded-xl border">
      {entries.map((entry) => (
        <li key={entry.id} className="flex flex-wrap items-start gap-3 px-4 py-3">
          {entry.imageAssetId && (
            // eslint-disable-next-line @next/next/no-img-element -- small admin-only thumbnail
            <img src={`/api/media/${entry.imageAssetId}`} alt="" className="size-12 rounded-md object-cover" />
          )}
          <div className="min-w-0 flex-1">
            <p className="font-medium">
              {proposalLabel(entry)} <Badge tone={entry.kind === 'PART' ? 'cyan' : 'neutral'}>{entry.kind === 'PART' ? 'Teil' : 'Set'}</Badge>
            </p>
            <p className="text-sm text-current/60">
              von @{entry.submittedBy} · {new Date(entry.createdAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}
            </p>
            {rejectNoteFor === entry.id && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Begründung (erforderlich)"
                  className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-base-dark-alt"
                />
                <Button size="sm" disabled={busyId === entry.id || note.trim() === ''} onClick={() => void settle(entry.id, 'REJECTED', note)}>
                  Bestätigen
                </Button>
              </div>
            )}
          </div>
          <Badge tone="cyan">Ausstehend</Badge>
          <Button size="sm" disabled={busyId === entry.id} onClick={() => void settle(entry.id, 'APPROVED')}>
            Genehmigen
          </Button>
          <Button size="sm" variant="secondary" disabled={busyId === entry.id} onClick={() => setRejectNoteFor(entry.id)}>
            Ablehnen
          </Button>
        </li>
      ))}
    </ul>
  )
}
