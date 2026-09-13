// app/decks/item/[id]/page.tsx
// Deck detail + deck builder. MVP4/4 (#144): die Seite ist nicht mehr owner-only — Decks
// sind niemals geheim (#139: "spätestens in Turnieren sind sie sichtbar"):
//   • Owner: DeckBuilder (Titel/Builds bearbeiten) + Sichtbarkeits-Umschalter
//     (DeckVisibilityToggle → PATCH /api/decks/[id], PUBLIC|UNLISTED).
//   • Alle anderen (inkl. Gäste): read-only-Ansicht — Titel, Besitzer:in, Builds mit
//     Turnier-Statistiken. Existenz wird nicht geleakt: 404 nur für unbekannte ids.
// Beide Ansichten zeigen die Turnier-Statistiken (Auto-Meta): das Deck-Aggregat
// (lib/deckStats.ts aggregateDeckStats) plus pro-Build-Winrate direkt an den Build-Zeilen.
// [FIX] Moved from app/decks/[id] to app/decks/item/[id] (mirroring
// /collection/item/[id]'s existing convention) — Next.js rejects two sibling dynamic routes
// with different param names at the same path depth ("/decks/[id]" vs "/decks/[username]",
// the Phase 10 public listing page); this was a genuine build-breaking bug that had never
// been caught locally (a full `next build` production build, not `next typegen`/`tsc`, is
// what actually enforces this).
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getDictionary } from '@/lib/i18n/server'
import { getBuildStats } from '@/lib/metaCache'
import { aggregateDeckStats } from '@/lib/deckStats'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { BuildCard } from '@/components/beyblade/BuildCard'
import { DeckBuilder } from '@/components/beyblade/DeckBuilder'
import { DeckVisibilityToggle } from '@/components/beyblade/DeckVisibilityToggle'
import { WinRateBadge } from '@/components/beyblade/WinRateBadge'

export const dynamic = 'force-dynamic'

const BUILD_INCLUDE = {
  blade: { select: { id: true, name: true, imageId: true } },
  lockChip: { select: { id: true, name: true } },
  overBlade: { select: { id: true, name: true } },
  metalBlade: { select: { id: true, name: true } },
  assistBlade: { select: { id: true, name: true } },
  ratchet: { select: { id: true, name: true } },
  bit: { select: { id: true, name: true } },
} as const

export default async function DeckDetailPage({ params }: PageProps<'/decks/item/[id]'>) {
  const { id } = await params
  const session = await auth()
  const viewerId = session?.user?.id ?? null
  const t = await getDictionary()

  const deck = await prisma.deck.findUnique({
    where: { id },
    include: {
      // Besitzer:in für die read-only-Ansicht (Username ist die öffentliche Identität).
      user: { select: { username: true } },
      builds: {
        orderBy: { position: 'asc' },
        include: { build: { include: BUILD_INCLUDE } },
      },
    },
  })
  if (!deck) notFound()

  const isOwner = deck.userId === viewerId

  // Turnier-Statistiken (Auto-Meta): ein Batch-getBuildStats für alle Deck-Builds, daraus
  // das Deck-Aggregat (lib/deckStats.ts).
  const buildStats = await getBuildStats(deck.builds.map((db) => db.build.id))
  const deckStats = aggregateDeckStats([...buildStats.values()])

  const statsSection = (
    <section aria-labelledby="deck-stats" className="space-y-3">
      <h2 id="deck-stats" className="text-lg font-semibold">{t.decks.statsHeading}</h2>
      <Card className="flex flex-wrap items-center gap-3 p-4">
        <WinRateBadge stats={deckStats} />
        <p className="text-xs text-current/50">
          {t.decks.buildsBadge.replace('{count}', String(deck.builds.length))}
        </p>
      </Card>
    </section>
  )

  if (isOwner) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
        <h1 className="text-2xl font-semibold">{t.decks.editHeading}</h1>

        {/* #144 — Sichtbarkeits-Umschalter (PUBLIC = gelistet, UNLISTED = nicht gelistet,
            aber niemals geheim). */}
        <Card className="p-4">
          <p className="mb-2 text-sm font-semibold">{t.decks.visibilityLabel}</p>
          <DeckVisibilityToggle
            deckId={deck.id}
            initial={deck.visibility}
            labels={{
              publicBadge: t.decks.visibilityPublic,
              unlistedBadge: t.decks.visibilityUnlisted,
              switchToPublic: t.decks.switchToPublic,
              switchToUnlisted: t.decks.switchToUnlisted,
              hint: t.decks.visibilityHint,
              errorPrefix: t.decks.visibilityError,
            }}
          />
        </Card>

        <Card>
          <DeckBuilder
            deckId={deck.id}
            initialTitle={deck.title}
            initialBuilds={deck.builds.map((db) => ({
              id: db.build.id,
              type: db.build.type,
              blade: db.build.blade,
              lockChip: db.build.lockChip,
              overBlade: db.build.overBlade,
              metalBlade: db.build.metalBlade,
              assistBlade: db.build.assistBlade,
              ratchet: db.build.ratchet,
              bit: db.build.bit,
            }))}
          />
        </Card>

        {statsSection}
      </main>
    )
  }

  // Read-only (andere User + Gäste): Decks sind niemals geheim — Titel, Besitzer:in,
  // Builds und Turnier-Statistiken sind sichtbar, bearbeiten darf nur die Besitzerin bzw.
  // der Besitzer.
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <Link href="/decks" className="text-sm text-current/60 underline underline-offset-2">← {t.decks.heading}</Link>

      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-semibold">{deck.title}</h1>
        <Badge tone={deck.visibility === 'PUBLIC' ? 'cyan' : 'neutral'}>
          {deck.visibility === 'PUBLIC' ? t.decks.visibilityPublic : t.decks.visibilityUnlisted}
        </Badge>
      </div>
      <p className="text-sm text-current/60">
        {t.decks.ownerLine}{' '}
        <Link href={`/profile/${encodeURIComponent(deck.user.username)}`} className="underline underline-offset-2">
          {deck.user.username}
        </Link>
      </p>
      <p className="text-xs text-current/50">{t.decks.viewOnlyNote}</p>

      <section aria-labelledby="deck-builds" className="space-y-3">
        <h2 id="deck-builds" className="text-lg font-semibold">{t.decks.buildsHeading}</h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {deck.builds.map((db) => (
            <li key={db.buildId}>
              <BuildCard
                build={{
                  id: db.build.id,
                  type: db.build.type,
                  blade: db.build.blade,
                  lockChip: db.build.lockChip,
                  overBlade: db.build.overBlade,
                  metalBlade: db.build.metalBlade,
                  assistBlade: db.build.assistBlade,
                  ratchet: db.build.ratchet,
                  bit: db.build.bit,
                  name: db.build.name,
                  imageId: db.build.imageId,
                }}
                winRate={buildStats.get(db.build.id) ?? null}
              />
            </li>
          ))}
        </ul>
      </section>

      {statsSection}
    </main>
  )
}
