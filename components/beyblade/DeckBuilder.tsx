// components/beyblade/DeckBuilder.tsx
// The deck builder: rename the deck, search the build catalog (GET /api/builds — the same
// server-side search /builds uses, not a raw dropdown), and compose up to three builds.
// The no-duplicate-parts rule gives INSTANT client-side feedback via lib/deckValidation; the
// server re-enforces it on PATCH, and DeckBuild's @@unique([deckId, buildId]) is the DB backstop.
'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/FormField'
import { Input } from '@/components/ui/Input'
import { TypeBadge } from '@/components/beyblade/TypeBadge'
import { WinRateBadge } from '@/components/beyblade/WinRateBadge'
import { CatalogProposalCTA } from '@/components/proposals/CatalogProposalCTA'
import { BuildComboForm } from '@/components/beyblade/BuildComboForm'
import { buildDisplayName, buildPartSummary, type BuildCardData } from '@/components/beyblade/BuildCard'
import type { WinRateStats } from '@/components/beyblade/WinRateBadge'
import { validateNoDuplicateParts } from '@/lib/deckValidation'

const MAX_BUILDS = 3

// #164 — eigenes Build-Bild, sonst das Blade-/Lock-Chip-Bild als Fallback (dasselbe Prinzip
// wie BuildCard.tsx — ein persönlicher Build hat fast nie ein eigenes Bild).
function deckThumbnail(build: {
  imageId?: string | null
  blade?: { id: string; imageId?: string | null } | null
  lockChip?: { id: string; imageId?: string | null } | null
}) {
  return build.imageId ?? build.blade?.imageId ?? build.lockChip?.imageId ?? null
}

interface SearchResult {
  id: string
  type: BuildCardData['type']
  name: string | null
  visibility?: 'PUBLIC' | 'UNLISTED'
  blade: { id: string; name: string; imageId: string | null } | null
  lockChip: { id: string; name: string } | null
  overBlade: { id: string; name: string } | null
  metalBlade: { id: string; name: string } | null
  assistBlade: { id: string; name: string } | null
  ratchet: { id: string; name: string } | null
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
  // #164 — "Deck speichern" gab bisher kein Erfolgs-Feedback (nur Fehler). Kurzer, sich selbst
  // zurücksetzender Hinweis, wie an anderen Stellen der App ("Gespeichert.").
  const [saved, setSaved] = useState(false)

  // Client-side deck rule check — instant feedback while composing. Same library function
  // the API route runs server-side; BuildCardData carries the part ids for exactly this.
  // RC16 (#122): alle 7 Slots (leere Slots zählen nicht — zwei Ratchet-Integrated-Builds
  // teilen sich NICHT das Ratchet null).
  const { valid, conflicts } = useMemo(
    () =>
      validateNoDuplicateParts(
        deck.map((b) => ({
          id: b.id,
          bladeId: b.blade?.id ?? null,
          lockChipId: b.lockChip?.id ?? null,
          overBladeId: b.overBlade?.id ?? null,
          metalBladeId: b.metalBlade?.id ?? null,
          assistBladeId: b.assistBlade?.id ?? null,
          ratchetId: b.ratchet?.id ?? null,
          bitId: b.bit.id,
          blade: b.blade,
          lockChip: b.lockChip,
          overBlade: b.overBlade,
          metalBlade: b.metalBlade,
          assistBlade: b.assistBlade,
          ratchet: b.ratchet,
          bit: b.bit,
        })),
      ),
    [deck],
  )

  async function search(e: React.FormEvent) {
    e.preventDefault()
    const params = new URLSearchParams({ q: query.trim() })
    // Phase 11 (item 6): "nur meine Teile" — a build is offered only when the caller owns all
    // of its constituent parts (RC16 #122: 2–6 je nach Bauform; leere Slots zählen nicht).
    if (onlyMine) params.set('onlyMine', '1')
    const res = await fetch(`/api/builds?${params}`)
    if (!res.ok) return
    const body = (await res.json()) as { builds: SearchResult[] }
    setResults(body.builds)
    setSearched(true)
  }

  function add(build: SearchResult) {
    setSaved(false)
    setDeck((d) => [...d, {
      id: build.id,
      type: build.type,
      blade: build.blade,
      lockChip: build.lockChip,
      overBlade: build.overBlade,
      metalBlade: build.metalBlade,
      assistBlade: build.assistBlade,
      ratchet: build.ratchet,
      bit: build.bit,
      ...(build.name !== undefined ? { name: build.name } : {}),
    }])
  }

  function remove(buildId: string) {
    setSaved(false)
    setDeck((d) => d.filter((b) => b.id !== buildId))
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!valid) return
    setBusy(true)
    setError(null)
    setSaved(false)
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
    setSaved(true)
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
                {/* #164 — eigenes Build-Bild, sonst Blade/Lock-Chip als Fallback. */}
                {deckThumbnail(build) ? (
                  <Image
                    src={`/api/media/${deckThumbnail(build)}`}
                    alt=""
                    width={40}
                    height={40}
                    sizes="40px"
                    className="h-10 w-10 shrink-0 rounded-lg object-contain"
                  />
                ) : (
                  <div aria-hidden="true" className="h-10 w-10 shrink-0 rounded-lg bg-x-cyan/10" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{buildDisplayName(build)}</p>
                  <p className="truncate text-sm text-current/60">{buildPartSummary(build)}</p>
                </div>
                <TypeBadge type={build.type} />
                <Button variant="ghost" size="sm" onClick={() => remove(build.id)} aria-label={`${buildDisplayName(build)} entfernen`}>
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
                  {/* #164 — eigenes Build-Bild, sonst Blade als Fallback (SearchResult trägt
                      keine lockChip.imageId — für CX-Builds ohne Blade bleibt der Platzhalter). */}
                  {deckThumbnail(build) ? (
                    <Image
                      src={`/api/media/${deckThumbnail(build)}`}
                      alt=""
                      width={40}
                      height={40}
                      sizes="40px"
                      className="h-10 w-10 shrink-0 rounded-lg object-contain"
                    />
                  ) : (
                    <div aria-hidden="true" className="h-10 w-10 shrink-0 rounded-lg bg-x-cyan/10" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{buildDisplayName(build)}</p>
                    <p className="truncate text-sm text-current/60">{buildPartSummary(build)}</p>
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
      {saved && !busy && <p role="status" className="text-sm text-type-balance">Gespeichert.</p>}
      <Button type="submit" disabled={busy || !valid}>
        {busy ? 'Speichere…' : 'Deck speichern'}
      </Button>
    </form>
  )
}
