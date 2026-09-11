// app/rules/page.tsx
// Public ruleset list: every isPublic ruleset, plus the viewer's own private ones when
// logged in. Paginated take/cursor per the standing performance convention. EmptyState
// when none exist; "Neues Regelwerk" CTA for logged-in users (guests see the
// anonymous-vs-member "Anmelden" prompt instead, per the Task 13 convention).
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { DECK_FORMAT_LABELS } from '@/lib/rulesetLabels'
import { isWobStandard } from '@/lib/wobBase'

export const revalidate = 300 // public, infrequently-mutated content [REVIEW-FIX: performance P16]

const PAGE_SIZE = 24

export default async function RulesPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>
}) {
  const { cursor } = await searchParams
  const session = await auth()

  const rulesets = await prisma.ruleset.findMany({
    where: {
      OR: [
        { isPublic: true },
        ...(session?.user?.id ? [{ createdById: session.user.id, isPublic: false }] : []),
      ],
    },
    // Ruleset has no createdAt column in spec §3 — id-desc keeps cursor pagination stable.
    orderBy: { id: 'desc' },
    take: PAGE_SIZE + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    // RC10 #72: the WoB comparison needs every comparable field, not just the card basics.
    select: {
      id: true,
      title: true,
      slug: true,
      description: true,
      deckFormat: true,
      isPublic: true,
      targetPoints: true,
      finalsTargetPoints: true,
      relaunchLimit: true,
      lockedDecks: true,
      allowForceSwitch: true,
      arenaTurnAllowed: true,
      outOfBounds2Pts: true,
      ownFinishPenalty: true,
      aerialContactRerun: true,
      externalDisturbanceRerun: true,
    },
  })

  const hasMore = rulesets.length > PAGE_SIZE
  const page = hasMore ? rulesets.slice(0, PAGE_SIZE) : rulesets
  const nextCursor = hasMore ? page[page.length - 1].id : null

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold">Regelwerke</h1>
        {session?.user ? (
          <Link
            href="/rules/new"
            className="rounded-md bg-x-cyan px-4 py-2 text-sm font-medium text-base-dark transition-colors hover:bg-x-cyan/85"
          >
            Neues Regelwerk
          </Link>
        ) : (
          <Link
            href="/login"
            className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium transition-colors hover:bg-current/5"
          >
            Anmelden, um zu erstellen
          </Link>
        )}
      </div>

      {page.length === 0 ? (
        <EmptyState
          title="Noch keine Regelwerke"
          description="Sobald jemand ein Regelwerk erstellt, erscheint es hier."
        />
      ) : (
        <ul className="space-y-3">
          {page.map((ruleset) => (
            <li key={ruleset.id}>
              <Card className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/rules/${ruleset.slug}`} className="font-semibold hover:underline">
                    {ruleset.title}
                  </Link>
                  <Badge tone="cyan">{DECK_FORMAT_LABELS[ruleset.deckFormat]}</Badge>
                  {/* #72: rulesets matching the WoB base in every comparable field are
                      flagged as the standard — deviations are visible on the detail page. */}
                  {isWobStandard(ruleset) && <Badge tone="green">WoB-Standard</Badge>}
                  {!ruleset.isPublic && <Badge tone="neutral">Privat</Badge>}
                </div>
                {ruleset.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-current/60">{ruleset.description}</p>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {nextCursor && (
        <div className="flex justify-center">
          <Link
            href={`/rules?cursor=${nextCursor}`}
            className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium transition-colors hover:bg-current/5"
          >
            Weitere laden
          </Link>
        </div>
      )}
    </main>
  )
}
