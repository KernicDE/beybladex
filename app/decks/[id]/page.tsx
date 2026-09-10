// app/decks/[id]/page.tsx
// Deck detail + deck builder. Owner-only in Part A (404 for anyone else — existence of
// another user's deck isn't leaked). Part C (tournament registration) consumes Deck rows
// server-side; public deck sharing would gate on decksVisibility via resolveVisibleFields.
import { notFound, redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { Card } from '@/components/ui/Card'
import { DeckBuilder } from '@/components/beyblade/DeckBuilder'

export const dynamic = 'force-dynamic'

export default async function DeckDetailPage({ params }: PageProps<'/decks/[id]'>) {
  const { id } = await params
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const deck = await prisma.deck.findUnique({
    where: { id },
    include: {
      builds: {
        orderBy: { position: 'asc' },
        include: {
          build: {
            include: {
              blade: { select: { id: true, name: true, imageId: true } },
              ratchet: { select: { id: true, name: true } },
              bit: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  })
  if (!deck || deck.userId !== session.user.id) notFound()

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">Deck bearbeiten</h1>
      <Card>
        <DeckBuilder
          deckId={deck.id}
          initialTitle={deck.title}
          initialBuilds={deck.builds.map((db) => ({
            id: db.build.id,
            type: db.build.type,
            blade: db.build.blade,
            ratchet: db.build.ratchet,
            bit: db.build.bit,
          }))}
        />
      </Card>
    </main>
  )
}
