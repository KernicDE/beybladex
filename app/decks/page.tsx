// app/decks/page.tsx
// The caller's own decks (Phase 5 Part A). Per-user surface — force-dynamic per the caching
// half of the Regression Guard. Guests get an explained GuestGate instead of a silent
// redirect (RC8 issue #20) with a callbackUrl, so they return here after login. Empty state
// carries the "Erstelle dein erstes Deck" CTA (standing empty-state rule); ?neu=1 reveals
// the create form.
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { TypeBadge } from '@/components/beyblade/TypeBadge'
import { DeckCreateForm } from '@/components/beyblade/DeckCreateForm'
import { GuestGate } from '@/components/auth/GuestGate'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20

export default async function DecksPage({ searchParams }: PageProps<'/decks'>) {
  const { cursor, neu } = await searchParams
  const session = await auth()
  if (!session?.user?.id) {
    return (
      <GuestGate
        title="Decks sind nur für Mitglieder"
        description="Ein Deck besteht aus bis zu drei Builds, mit denen du an Turnieren teilnimmst. Melde dich an, um deine Decks zu erstellen und zu verwalten."
        callbackUrl="/decks"
      />
    )
  }

  const rows = await prisma.deck.findMany({
    where: { userId: session.user.id },
    orderBy: { id: 'asc' },
    take: PAGE_SIZE + 1,
    ...(typeof cursor === 'string' && cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    include: {
      builds: {
        orderBy: { position: 'asc' },
        include: {
          build: {
            select: { id: true, type: true, blade: { select: { name: true } }, ratchet: { select: { name: true } }, bit: { select: { name: true } } },
          },
        },
      },
    },
  })
  const hasMore = rows.length > PAGE_SIZE
  const decks = hasMore ? rows.slice(0, PAGE_SIZE) : rows
  const nextCursor = hasMore ? decks[decks.length - 1].id : null

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Meine Decks</h1>
        {decks.length > 0 && (
          <Link href="/decks?neu=1" className="rounded-md bg-x-cyan px-4 py-2 text-sm font-medium text-base-dark transition-colors hover:bg-x-cyan/85">
            Neues Deck
          </Link>
        )}
      </div>

      {neu === '1' && (
        <Card>
          <DeckCreateForm />
        </Card>
      )}

      {decks.length === 0 && neu !== '1' ? (
        <EmptyState
          title="Noch keine Decks"
          description="Ein Deck besteht aus bis zu drei Builds, die nicht dasselbe Teil teilen dürfen."
          action={
            <Link href="/decks?neu=1" className="rounded-md bg-x-cyan px-4 py-2 text-sm font-medium text-base-dark transition-colors hover:bg-x-cyan/85">
              Erstelle dein erstes Deck
            </Link>
          }
        />
      ) : (
        <ul className="space-y-3">
          {decks.map((deck) => (
            <li key={deck.id}>
              <Card className="p-4">
                <Link href={`/decks/item/${deck.id}`} className="block space-y-2">
                  <div className="flex items-center gap-2">
                    <p className="font-medium">{deck.title}</p>
                    <Badge tone="neutral">{deck.builds.length}/3 Builds</Badge>
                  </div>
                  <ul className="text-sm text-current/60">
                    {deck.builds.map((db) => (
                      <li key={db.buildId} className="flex items-center gap-2">
                        <TypeBadge type={db.build.type} />
                        {db.build.blade.name} · {db.build.ratchet.name} · {db.build.bit.name}
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
        <Link href={`/decks?cursor=${nextCursor}`} className="inline-block underline underline-offset-2">
          Weitere Decks laden
        </Link>
      )}
    </main>
  )
}
