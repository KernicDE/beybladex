// components/tournament/SeedingPanel.tsx (Phase 15)
// Pre-bracket-generation seeding UI in the OrganizerConsole: a numeric seed input per
// participant (manual, cleared back to auto with an empty value) plus "Nach Elo-Rating setzen"
// and "Zufällig mischen" buttons that seed everyone WITHOUT a manual value already set — a
// manually-set seed always wins (binding rule; the API enforces this too, this is just the UI
// reflecting it). Only rendered before the tournament's first stage has any matches — seeding
// is read once, at generation time, so it has no further effect afterward (see the API route's
// own comment).
'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'

export type SeedableParticipant = { userId: string; name: string; seed: number | null }

export function SeedingPanel({ tournamentId, participants }: { tournamentId: string; participants: SeedableParticipant[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const call = async (body: unknown) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/tournaments/${tournamentId}/participants/seed`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string }
        setError(b.error ?? `Fehler (${res.status})`)
      } else {
        router.refresh()
      }
    } catch {
      setError('Netzwerkfehler — bitte erneut versuchen.')
    } finally {
      setBusy(false)
    }
  }

  const commitManual = (userId: string, raw: string) => {
    const trimmed = raw.trim()
    const value = trimmed === '' ? null : Number(trimmed)
    if (value !== null && (!Number.isInteger(value) || value < 1)) return
    const current = participants.find((p) => p.userId === userId)?.seed ?? null
    if (value === current) return
    void call({ method: 'manual', seeds: { [userId]: value } })
  }

  // Remount the input list whenever the server-provided seed values change (e.g. after "Nach
  // Elo setzen"/"Zufällig mischen" trigger a router.refresh()) — a key change forces React to
  // discard the previous instance's local draft state and re-initialize from the new props,
  // rather than a setState-in-effect sync (react-hooks/set-state-in-effect).
  const seedSignature = participants.map((p) => `${p.userId}:${p.seed}`).join(',')

  return (
    <section aria-labelledby="seeding-heading" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="seeding-heading" className="text-sm font-semibold">Seeding</h3>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void call({ method: 'rating' })}>
            Nach Elo-Rating setzen
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void call({ method: 'shuffle' })}>
            Zufällig mischen
          </Button>
        </div>
      </div>
      <p className="text-xs text-current/50">
        Manuell gesetzte Seeds (Zahl eintragen) gewinnen immer — „Nach Elo“/„Zufällig mischen“
        ordnen nur die restlichen Teilnehmer:innen ohne manuellen Seed. Feld leeren, um wieder auf
        automatisch zurückzustellen. Wirkt erst bei der nächsten Bracket-Generierung.
      </p>
      {error && <p role="alert" className="text-sm text-type-attack">{error}</p>}
      <SeedInputList key={seedSignature} participants={participants} busy={busy} onCommit={commitManual} />
    </section>
  )
}

function SeedInputList({
  participants,
  busy,
  onCommit,
}: {
  participants: SeedableParticipant[]
  busy: boolean
  onCommit: (userId: string, raw: string) => void
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>(
    Object.fromEntries(participants.map((p) => [p.userId, p.seed === null ? '' : String(p.seed)]))
  )
  const sortedByCurrentSeed = [...participants].sort((a, b) => {
    if (a.seed !== null && b.seed !== null) return a.seed - b.seed
    if (a.seed !== null) return -1
    if (b.seed !== null) return 1
    return a.name.localeCompare(b.name)
  })

  return (
    <ul className="space-y-1">
      {sortedByCurrentSeed.map((p) => (
        <li key={p.userId} className="flex items-center justify-between gap-2 text-sm">
          <span>{p.name}</span>
          <input
            type="number"
            min={1}
            placeholder="auto"
            value={drafts[p.userId] ?? ''}
            onChange={(e) => setDrafts((d) => ({ ...d, [p.userId]: e.target.value }))}
            onBlur={() => onCommit(p.userId, drafts[p.userId] ?? '')}
            disabled={busy}
            className="w-20 rounded-md border border-current/20 bg-transparent px-2 py-1 text-right text-sm text-current"
            aria-label={`Seed für ${p.name}`}
          />
        </li>
      ))}
    </ul>
  )
}
