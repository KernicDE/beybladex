// app/settings/admin/parts/page.tsx
// Parts-catalog curation. Two distinct authz tiers on one page (Phase 11 widened the reviewer
// tier past the original TRUSTED/ADMIN pair, but NOT the direct-authoring tier):
// - Page gate / proposal review: TRUSTED, JUDGE, ORGANIZER, or ADMIN (lib/roles.ts's
//   isCurator) — the people most likely to encounter an uncatalogued real-world part.
// - Direct catalog authoring (the searchable list + inline PartForm edit/create): TRUSTED or
//   ADMIN only, unchanged — the API twin (/api/admin/parts) still 403s everyone else, so a
//   JUDGE/ORGANIZER reaching this page sees ONLY the proposal queue, not the catalog-edit UI.
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { PartForm } from '@/components/admin/PartForm'
import { ProposalQueue, type ProposalEntry } from '@/components/admin/ProposalQueue'
import { isCurator } from '@/lib/roles'

export const dynamic = 'force-dynamic' // privileged, per-user surface — never cached

const PAGE_SIZE = 25

export default async function AdminPartsPage({ searchParams }: PageProps<'/settings/admin/parts'>) {
  const { q, category, cursor } = await searchParams
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const caller = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
  if (!isCurator(caller?.role)) redirect('/settings/profile')
  const canAuthor = caller?.role === 'TRUSTED' || caller?.role === 'ADMIN'

  const query = typeof q === 'string' ? q.trim() : ''
  const categoryFilter = typeof category === 'string' ? category : ''

  const rows = canAuthor
    ? await prisma.part.findMany({
        where: {
          ...(query ? { name: { contains: query, mode: 'insensitive' } } : {}),
          ...(categoryFilter ? { category: categoryFilter as 'BLADE' | 'RATCHET' | 'BIT' | 'ACCESSORY' } : {}),
        },
        orderBy: { name: 'asc' },
        take: PAGE_SIZE + 1,
        ...(typeof cursor === 'string' && cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })
    : []
  const hasMore = rows.length > PAGE_SIZE
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows
  const nextCursor = hasMore ? page[page.length - 1].id : null

  const proposalRows = await prisma.catalogProposal.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: 50,
    include: { submittedBy: { select: { username: true } } },
  })
  const proposals: ProposalEntry[] = proposalRows.map((p) => ({
    id: p.id,
    kind: p.kind,
    payload: p.payload as unknown as ProposalEntry['payload'],
    imageAssetId: p.imageAssetId,
    submittedBy: p.submittedBy.username,
    createdAt: p.createdAt.toISOString(),
  }))

  const toFormValues = (part: (typeof page)[number]) => ({
    id: part.id,
    name: part.name,
    manufacturer: part.manufacturer,
    category: part.category,
    beyType: part.beyType ?? '',
    spinDirection: part.spinDirection,
    weightGrams: part.weightGrams?.toString() ?? '',
    imageId: part.imageId,
  })

  return (
    <section aria-labelledby="admin-parts-heading" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id="admin-parts-heading" className="text-xl font-semibold">Teile-Katalog</h2>
        <Link href="/settings/admin" className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium transition-colors hover:bg-current/5">
          Nutzer:innen-Verwaltung
        </Link>
      </div>

      {canAuthor && (
        <form action="/settings/admin/parts" className="flex flex-wrap items-center gap-2">
          <label htmlFor="parts-q" className="sr-only">Teilname suchen</label>
          <Input id="parts-q" name="q" defaultValue={query} placeholder="Teilname suchen…" className="w-64" />
          <label htmlFor="parts-category" className="sr-only">Kategorie filtern</label>
          <select id="parts-category" name="category" defaultValue={categoryFilter} className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-base-dark-alt">
            <option value="">Alle Kategorien</option>
            <option value="BLADE">Blades</option>
            <option value="RATCHET">Ratchets</option>
            <option value="BIT">Bits</option>
            <option value="ACCESSORY">Zubehör</option>
          </select>
          <button type="submit" className="rounded-md bg-x-cyan px-4 py-2 text-sm font-medium text-base-dark transition-colors hover:bg-x-cyan/85">
            Filtern
          </button>
        </form>
      )}

      {canAuthor && (
        page.length === 0 ? (
          <EmptyState title="Keine Teile gefunden" description="Passe die Suche an oder lege das Teil unten neu an." />
        ) : (
          <ul className="space-y-4">
            {page.map((part) => (
              <li key={part.id}>
                <Card>
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <p className="font-medium">{part.name}</p>
                    <Badge tone="cyan">{part.category}</Badge>
                    <Badge tone="neutral">{part.manufacturer === 'TT' ? 'Takara Tomy' : 'Hasbro'}</Badge>
                  </div>
                  <PartForm initial={toFormValues(part)} />
                </Card>
              </li>
            ))}
          </ul>
        )
      )}
      {canAuthor && nextCursor && (
        <Link
          href={`/settings/admin/parts?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(categoryFilter ? { category: categoryFilter } : {}), cursor: nextCursor })}`}
          className="inline-block underline underline-offset-2"
        >
          Weitere Teile laden
        </Link>
      )}

      <div className="space-y-3">
        <h3 className="text-lg font-semibold">Katalog-Vorschläge — ausstehend</h3>
        {proposals.length === 0 ? (
          <EmptyState title="Keine ausstehenden Vorschläge" description="Wenn Nutzer:innen ein fehlendes Teil oder Set vorschlagen, landet es hier." />
        ) : (
          <ProposalQueue entries={proposals} />
        )}
      </div>

      {canAuthor && (
        <Card>
          <h3 className="mb-3 text-lg font-semibold">Neues Teil anlegen</h3>
          <PartForm />
        </Card>
      )}
    </section>
  )
}
