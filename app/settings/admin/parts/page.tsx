// app/settings/admin/parts/page.tsx
// Parts-catalog curation (Phase 5 Part A): searchable/paginated catalog list with an inline
// edit form per part, a "Neues Teil" create form, and the "request missing part" queue below.
// Gate: TRUSTED or ADMIN — the API twin (/api/admin/parts) returns 403 for everyone else, so
// the redirect hides nothing. (ADMIN reaches this page via a link on /settings/admin; TRUSTED
// catalog contributors use the direct URL — the settings tab bar only shows Admin to ADMIN.)
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { PartForm } from '@/components/admin/PartForm'
import { PartRequestQueue } from '@/components/admin/PartRequestQueue'

export const dynamic = 'force-dynamic' // privileged, per-user surface — never cached

const PAGE_SIZE = 25

export default async function AdminPartsPage({ searchParams }: PageProps<'/settings/admin/parts'>) {
  const { q, category, cursor } = await searchParams
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const caller = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } })
  if (caller?.role !== 'TRUSTED' && caller?.role !== 'ADMIN') redirect('/settings/profile')

  const query = typeof q === 'string' ? q.trim() : ''
  const categoryFilter = typeof category === 'string' ? category : ''

  const rows = await prisma.part.findMany({
    where: {
      ...(query ? { name: { contains: query, mode: 'insensitive' } } : {}),
      ...(categoryFilter ? { category: categoryFilter as 'BLADE' | 'RATCHET' | 'BIT' | 'ACCESSORY' } : {}),
    },
    orderBy: { name: 'asc' },
    take: PAGE_SIZE + 1,
    ...(typeof cursor === 'string' && cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })
  const hasMore = rows.length > PAGE_SIZE
  const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows
  const nextCursor = hasMore ? page[page.length - 1].id : null

  const requests = await prisma.partRequest.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'asc' },
    take: 50,
    include: { requestedBy: { select: { username: true } } },
  })

  const toFormValues = (part: (typeof page)[number]) => ({
    id: part.id,
    name: part.name,
    manufacturer: part.manufacturer,
    category: part.category,
    beyType: part.beyType ?? '',
    spinDirection: part.spinDirection,
    weightGrams: part.weightGrams?.toString() ?? '',
    imageUrl: part.imageUrl ?? '',
  })

  return (
    <section aria-labelledby="admin-parts-heading" className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 id="admin-parts-heading" className="text-xl font-semibold">Teile-Katalog</h2>
        <Link href="/settings/admin" className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium transition-colors hover:bg-current/5">
          Nutzer:innen-Verwaltung
        </Link>
      </div>

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

      {page.length === 0 ? (
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
      )}
      {nextCursor && (
        <Link
          href={`/settings/admin/parts?${new URLSearchParams({ ...(query ? { q: query } : {}), ...(categoryFilter ? { category: categoryFilter } : {}), cursor: nextCursor })}`}
          className="inline-block underline underline-offset-2"
        >
          Weitere Teile laden
        </Link>
      )}

      <div className="space-y-3">
        <h3 className="text-lg font-semibold">Fehlende Teile — Anfragen</h3>
        {requests.length === 0 ? (
          <EmptyState title="Keine ausstehenden Anfragen" description="Wenn Nutzer:innen ein fehlendes Teil melden, landet es hier." />
        ) : (
          <PartRequestQueue
            entries={requests.map((r) => ({
              ...r,
              createdAt: r.createdAt.toISOString(),
            }))}
          />
        )}
      </div>

      <Card>
        <h3 className="mb-3 text-lg font-semibold">Neues Teil anlegen</h3>
        <PartForm />
      </Card>
    </section>
  )
}
