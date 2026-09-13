// app/decks/page.tsx
// The caller's own decks (Phase 5 Part A). MVP4/4 (#144): Suche über den Decknamen und ein
// Sichtbarkeits-Badge pro Deck (PUBLIC = in öffentlichen Listungen sichtbar, UNLISTED =
// nicht gelistet, aber niemals geheim — per Direktlink/Turnier sichtbar). Der Umschalter
// selbst lebt auf der Deck-Detailseite. Per-user surface — force-dynamic per the caching
// half of the Regression Guard. Guests get an explained GuestGate instead of a silent
// redirect (RC8 issue #20) with a callbackUrl, so they return here after login. Empty state
// carries the "Erstelle dein erstes Deck" CTA (standing empty-state rule); ?neu=1 reveals
// the create form.
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getDictionary } from '@/lib/i18n/server'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { TypeBadge } from '@/components/beyblade/TypeBadge'
import { buildPartSummary } from '@/components/beyblade/BuildCard'
import { DeckCreateForm } from '@/components/beyblade/DeckCreateForm'
import { GuestGate } from '@/components/auth/GuestGate'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20

function str(v: string | string[] | undefined): string {
  return typeof v === 'string' ? v : ''
}

export default async function DecksPage({ searchParams }: PageProps<'/decks'>) {
  const { cursor, neu, q } = await searchParams
  // RC14-Nachzügler #130 — page chrome comes from the request dictionary.
  const t = await getDictionary()
  const session = await auth()
  if (!session?.user?.id) {
    return (
      <GuestGate
        title={t.decks.gateTitle}
        description={t.decks.gateDescription}
        callbackUrl="/decks"
        labels={t.guestGate}
      />
    )
  }

  const query = str(q).trim()
  const rows = await prisma.deck.findMany({
    where: {
      userId: session.user.id,
      ...(query ? { title: { contains: query, mode: 'insensitive' } } : {}),
    },
    orderBy: { id: 'asc' },
    take: PAGE_SIZE + 1,
    ...(typeof cursor === 'string' && cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      builds: {
        orderBy: { position: 'asc' },
        include: {
          build: {
            select: { id: true, type: true, blade: { select: { id: true, name: true } }, lockChip: { select: { id: true, name: true } }, overBlade: { select: { id: true, name: true } }, metalBlade: { select: { id: true, name: true } }, assistBlade: { select: { id: true, name: true } }, ratchet: { select: { id: true, name: true } }, bit: { select: { id: true, name: true } } },
          },
        },
      },
    },
  })
  const hasMore = rows.length > PAGE_SIZE
  const decks = hasMore ? rows.slice(0, PAGE_SIZE) : rows
  const nextCursor = hasMore ? decks[decks.length - 1]!.id : null

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t.decks.heading}</h1>
        {decks.length > 0 && (
          <Link href="/decks?neu=1" className="rounded-md bg-x-cyan px-4 py-2 text-sm font-medium text-base-dark transition-colors hover:bg-x-cyan/85">
            {t.decks.newDeck}
          </Link>
        )}
      </div>

      {neu === '1' && (
        <Card>
          <DeckCreateForm />
        </Card>
      )}

      <form role="search" action="/decks" className="flex items-center gap-2">
        <label htmlFor="decks-q" className="sr-only">{t.decks.searchLabel}</label>
        <Input id="decks-q" name="q" type="search" defaultValue={query} placeholder={t.decks.searchPlaceholder} />
        <button type="submit" className="rounded-md bg-x-cyan px-4 py-2 text-sm font-medium text-base-dark transition-colors hover:bg-x-cyan/85">
          {t.common.search}
        </button>
        {query && (
          <Link href="/decks" className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium transition-colors hover:bg-current/5">
            {t.catalog.reset}
          </Link>
        )}
      </form>

      {decks.length === 0 && neu !== '1' ? (
        query ? (
          <EmptyState
            title={t.decks.emptyFilteredTitle}
            description={t.decks.emptyFilteredDescription}
            action={
              <Link href="/decks" className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium transition-colors hover:bg-current/5">
                {t.catalog.reset}
              </Link>
            }
          />
        ) : (
          <EmptyState
            title={t.decks.emptyTitle}
            description={t.decks.emptyDescription}
            action={
              <Link href="/decks?neu=1" className="rounded-md bg-x-cyan px-4 py-2 text-sm font-medium text-base-dark transition-colors hover:bg-x-cyan/85">
                {t.decks.createFirst}
              </Link>
            }
          />
        )
      ) : (
        <ul className="space-y-3">
          {decks.map((deck) => (
            <li key={deck.id}>
              <Card className="p-4">
                <Link href={`/decks/item/${deck.id}`} className="block space-y-2">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{deck.title}</p>
                    <Badge tone="neutral">{t.decks.buildsBadge.replace('{count}', String(deck.builds.length))}</Badge>
                    {/* #144 — Sichtbarkeit des Decks (Umschalter auf der Detailseite). */}
                    <Badge tone={deck.visibility === 'PUBLIC' ? 'cyan' : 'neutral'}>
                      {deck.visibility === 'PUBLIC' ? t.decks.visibilityPublic : t.decks.visibilityUnlisted}
                    </Badge>
                  </div>
                  <ul className="text-sm text-current/60">
                    {deck.builds.map((db) => (
                      <li key={db.buildId} className="flex items-center gap-2">
                        <TypeBadge type={db.build.type} />
                        {buildPartSummary({ id: db.build.id, type: db.build.type, blade: db.build.blade, lockChip: db.build.lockChip, overBlade: db.build.overBlade, metalBlade: db.build.metalBlade, assistBlade: db.build.assistBlade, ratchet: db.build.ratchet, bit: db.build.bit })}
                      </li>
                    ))}
                  </ul>
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      )}
      {nextCursor && (
        <Link href={`/decks?${new URLSearchParams({ ...(query ? { q: query } : {}), cursor: nextCursor })}`} className="inline-block underline underline-offset-2">
          {t.decks.loadMore}
        </Link>
      )}
    </main>
  )
}
