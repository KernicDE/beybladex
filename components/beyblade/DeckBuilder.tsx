// components/beyblade/DeckBuilder.tsx
// The deck builder: rename the deck, search the build catalog (GET /api/builds — the same
// server-side search /builds uses, not a raw dropdown), and compose up to three builds.
// The no-duplicate-parts rule gives INSTANT client-side feedback via lib/deckValidation; the
// server re-enforces it on PATCH, and DeckBuild's @@unique([deckId, buildId]) is the DB backstop.
'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { TypeBadge } from '@/components/beyblade/TypeBadge'
import { WinRateBadge } from '@/components/beyblade/WinRateBadge'
import { CatalogProposalCTA } from '@/components/proposals/CatalogProposalCTA'
import { BuildComboForm } from '@/components/beyblade/BuildComboForm'
import type { BuildCardData } from '@/components/beyblade/BuildCard'
import type { WinRateStats } from '@/components/beyblade/WinRateBadge'
import { validateNoDuplicateParts } from '@/lib/deckValidation'

const MAX_BUILDS = 3

interface SearchResult {
  id: string
  type: BuildCardData['type']
  name: string | null
  isOfficialSet: boolean
  blade: { id: string; name: string; imageId: string | null }
  ratchet: { id: string; name: string }
  bit: { id: string; name: string }
  winRate: WinRateStats | null
  // Phase 11 (item 6): true/false when the search ran with onlyMine=1, absent otherwise.
  available?: boolean
}

export function DeckBuilder({ deckId, initialTitle, initialBuilds }: { deckId: string; initialTitle: string; initialBuilds: BuildCardData[] }) {
  const router = useRouter()
  const [title, setTitle] = useState(initialTitle)
  const [deck, setDeck] = useState<BuildCardData[]>(initialBuilds)
  const [query, setQuery] = useState('')
  const [onlyMine, setOnlyMine] = useState(false)
  const [results, setResults] = useState<SearchResult[]>([])
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Client-side deck rule check — instant feedback while composing. Same library function
  // the API route runs server-side; BuildCardData carries the part ids for exactly this.
  const { valid, conflicts } = useMemo(
    () =>
      validateNoDuplicateParts(
        deck.map((b) => ({ id: b.id, bladeId: b.blade.id, ratchetId: b.ratchet.id, bitId: b.bit.id, blade: b.blade, ratchet: b.ratchet, bit: b.bit })),
      ),
    [deck],
  )

  async function search(e: React.FormEvent) {
    e.preventDefault()
    const params = new URLSearchParams({ q: query.trim() })
    // Phase 11 (item 6): "nur meine Teile" — a build is offered only when the caller owns all
    // three constituent parts (CollectionItem, any sourceBuildId or none).
    if (onlyMine) params.set('onlyMine', '1')
    const res = await fetch(`/api/builds?${params}`)
    if (!res.ok) return
    const body = (await res.json()) as { builds: SearchResult[] }
    setResults(body.builds)
    setSearched(true)
  }

  function add(build: SearchResult) {
    setDeck((d) => [...d, {
      id: build.id,
      type: build.type,
      blade: build.blade,
      ratchet: build.ratchet,
      bit: build.bit,
      ...(build.name !== undefined ? { name: build.name, isOfficialSet: build.isOfficialSet } : {}),
    }])
  }

  function remove(buildId: string) {
    setDeck((d) => d.filter((b) => b.id !== buildId))
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    setBusy(true)
    setError(null)
    const res = await fetch(`/api/decks/${deckId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim(), buildIds: deck.map((b) => b.id) }),
    })
    setBusy(false)
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string; conflicts?: string[] } | null
      setError(body?.conflicts?.join(', ') ?? body?.error ?? `Fehler (${res.status})`)
      return
    }
    router.refresh()
  }

  return (
    <form onSubmit={save} className="space-y-6">
      <FormField label="Deckname">
        <Input required value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} />
      </FormField>

      <section aria-labelledby="deck-current" className="space-y-2">
        <h3 id="deck-current" className="font-medium">Deine Builds ({deck.length}/{MAX_BUILDS})</h3>
        {deck.length === 0 ? (
          <p className="text-sm text-current/60">Noch keine Builds im Deck — suche unten und füge bis zu drei hinzu.</p>
        ) : (
          <ul className="space-y-2">
            {deck.map((build, i) => (
              <li key={build.id} className="flex items-center gap-3 rounded-xl border border-x-cyan/20 p-3">
                <Badge tone="cyan">#{i + 1}</Badge>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{build.blade.name}</p>
                  <p className="truncate text-sm text-current/60">{build.ratchet.name} · {build.bit.name}</p>
                </div>
                <TypeBadge type={build.type} />
                <Button variant="ghost" size="sm" onClick={() => remove(build.id)} aria-label={`${build.blade.name} entfernen`}>
                  Entfernen
                </Button>
              </li>
            ))}
          </ul>
        )}
        {!valid && (
          <div role="alert" className="rounded-md border border-type-attack/40 bg-type-attack/10 p-3 text-sm text-type-attack">
            <p className="font-medium">Deck-Regel verletzt — gleiche Teile mehrfach verwendet:</p>
            <ul className="list-inside list-disc">
              {conflicts.map((c) => <li key={c}>{c}</li>)}
            </ul>
          </div>
        )}
      </section>

      <section aria-labelledby="deck-search" className="space-y-2">
        <h3 id="deck-search" className="font-medium">Builds suchen</h3>
        <div className="flex gap-2">
          <label htmlFor="deck-builder-q" className="sr-only">Builds suchen</label>
          <Input id="deck-builder-q" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Teilname, z. B. DranSword…" />
          <Button variant="secondary" onClick={search}>Suchen</Button>
        </div>
        <div className="flex items-center gap-2">
          <input
            id="deck-only-mine"
            type="checkbox"
            checked={onlyMine}
            onChange={(e) => setOnlyMine(e.target.checked)}
            className="size-4 accent-x-cyan"
          />
          <label htmlFor="deck-only-mine" className="text-sm text-current/70">
            Nur Builds, deren Teile ich besitze
          </label>
        </div>
        {searched && results.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-current/60">Keine Builds gefunden.</p>
            {/* Phase 11 (item 1): the gap is felt HERE — offer the one-off combo create
                (item 2) and the official-Set proposal (item 1) inline. */}
            <details className="rounded-xl border border-dashed border-x-cyan/20 p-4">
              <summary className="cursor-pointer text-sm font-medium">Nichts Passendes? Eigenen Build erstellen oder Set vorschlagen</summary>
              <div className="mt-3 space-y-4">
                <BuildComboForm onCreated={(build) => { setResults((r) => [{ ...build, winRate: null }, ...r]); setSearched(true) }} />
                <CatalogProposalCTA defaultKind="BUILD" />
              </div>
            </details>
          </div>
        )}
        {results.length > 0 && (
          <ul className="divide-y rounded-xl border">
            {results.map((build) => {
              const inDeck = deck.some((b) => b.id === build.id)
              const full = deck.length >= MAX_BUILDS
              return (
                <li key={build.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{build.blade.name}</p>
                    <p className="truncate text-sm text-current/60">{build.ratchet.name} · {build.bit.name}</p>
                  </div>
                  <TypeBadge type={build.type} />
                  {build.available !== undefined && (
                    <Badge tone={build.available ? 'cyan' : 'neutral'}>{build.available ? 'Baubar' : 'Teile fehlen'}</Badge>
                  )}
                  <WinRateBadge stats={build.winRate} />
                  <Button size="sm" disabled={inDeck || full} onClick={() => add(build)}>
                    {inDeck ? 'Im Deck' : full ? 'Deck voll' : 'Hinzufügen'}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {error && <p role="alert" className="text-sm text-type-attack">{error}</p>}
      <Button type="submit" disabled={busy || !valid}>
        Deck speichern
      </Button>
    </form>
  )
}
