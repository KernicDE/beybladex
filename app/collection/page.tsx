// app/collection/page.tsx
// Die Sammlung nach dem IA/UX-Umbau (MVP4/4, #144 — UX-Baum in #139): drei Tabs.
//   1. "Beyblades" — der Katalog aller offiziellen Sets (das ist der alte Katalog-Tab,
//      aufgewertet): Liste mit Name, Typ, Spinrichtung (beides abgeleitet aus dem Blade-Teil),
//      Hersteller-Badge und Batch-Rating-Summary; Filter: Suche (Name, Produktcode UND
//      Teilcode — "4-60" findet alle Sets mit einem 4-60-Ratchet, OR über alle 7 Slots),
//      Hersteller, Typ, "Nur im Besitz" (Purchase-Subquery). Klick → /beyblades/[id].
//   2. "Teile" — der Teile-Katalog: Suche + Kategorie-Filter, gruppiert nach Kategorie
//      (kanonische Assembly-Ordnung, lib/buildSearch.ts groupPartsByCategory). Klick → /parts/[id].
//   3. "Mein Inventar" — die eigenen CollectionItems (Phase 5 Part B), inkl. der Create-
//      Formulare (?neu=1, CollectionItemForm + MarkSetPurchasedForm) — das Inventar ist die
//      Verfügbarkeitsgrundlage der "Meine Builds"-Ansicht und bleibt deshalb erhalten, auch
//      wenn der UX-Baum in #139 nur Beyblades/Teile auflistet.
// Legacy-Tab-Namen bleiben als Aliasse gültig: tab=katalog → Beyblades, tab=mine → Inventar.
// Per-user surface — force-dynamic per the caching half of the Regression Guard; guests get
// the explained GuestGate (RC8 #20) with a callbackUrl. Beyblades-/Teile-Tab paginieren mit
// echten Seitenzahlen (#155, kpage/ppage — components/ui/Pagination.tsx); "Mein Inventar"
// bleibt vorerst cursor-basiert ("Weitere laden", eigenes Issue #155 nennt es explizit als
// Scope-Grenze).
import Image from 'next/image'
import Link from 'next/link'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getRateTable, type FxCurrency } from '@/lib/currency'
import { getDictionary } from '@/lib/i18n/server'
import { searchBeyblades } from '@/lib/beybladeSearch'
import { searchParts, groupPartsByCategory, PART_CATEGORY_ORDER, PART_CATEGORY_LABELS } from '@/lib/buildSearch'
import { getPartStats } from '@/lib/metaCache'
import { shapeRatingAggregates } from '@/lib/ratingAggregate'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Tabs, type TabDef } from '@/components/ui/Tabs'
import { Pagination } from '@/components/ui/Pagination'
import { BeybladeCard } from '@/components/beyblade/BeybladeCard'
import { CatalogProposalCTA } from '@/components/proposals/CatalogProposalCTA'
import { TypeBadge } from '@/components/beyblade/TypeBadge'
import { WinRateBadge } from '@/components/beyblade/WinRateBadge'
import { CollectionItemCard } from '@/components/collection/CollectionItemCard'
import { CollectionItemForm } from '@/components/collection/CollectionItemForm'
import { MarkSetPurchasedForm } from '@/components/collection/MarkSetPurchasedForm'
import { GuestGate } from '@/components/auth/GuestGate'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 20
const KATALOG_PAGE_SIZE = 20
const PARTS_TAB_PAGE_SIZE = 60

const BEY_TYPES = [
  { value: 'ATTACK', labelKey: 'typeAttack' },
  { value: 'DEFENSE', labelKey: 'typeDefense' },
  { value: 'STAMINA', labelKey: 'typeStamina' },
  { value: 'BALANCE', labelKey: 'typeBalance' },
] as const

function str(v: string | string[] | undefined): string {
  return typeof v === 'string' ? v : ''
}

// #155 — 1-indexiert, nicht-numerisch/negativ fällt auf Seite 1 zurück statt zu crashen.
function pageNum(v: string | string[] | undefined): number {
  const n = typeof v === 'string' ? parseInt(v, 10) : NaN
  return Number.isFinite(n) && n >= 1 ? n : 1
}

export default async function CollectionPage({ searchParams }: PageProps<'/collection'>) {
  const { cursor, kpage, ppage, neu, tab, q, mf, bt, owned, pq, pc, pt, psd, powned } = await searchParams
  // RC14-Nachzügler #130 — page chrome comes from the request dictionary.
  const t = await getDictionary()
  const session = await auth()
  if (!session?.user?.id) {
    return (
      <GuestGate
        title={t.collection.gateTitle}
        description={t.collection.gateDescription}
        callbackUrl="/collection"
        labels={t.guestGate}
      />
    )
  }
  const viewerId = session.user.id

  // Tab-Auflösung inkl. Legacy-Aliasse (tab=katalog → Beyblades, tab=mine → Inventar).
  const activeTab: 'beyblades' | 'teile' | 'inventar' =
    tab === 'teile' ? 'teile' : tab === 'inventar' || tab === 'mine' ? 'inventar' : 'beyblades'

  // Beyblades-Tab: Suche + Filter.
  const catalogQ = str(q).trim()
  const catalogMf = str(mf)
  const catalogBt = str(bt)
  const ownedOnly = owned === '1'
  const catalogPage = pageNum(kpage)
  // Teile-Tab: Suche + Kategorie-/Typ-/Drehrichtungs-/Besitz-Filter (#137).
  const partsQ = str(pq).trim()
  const partsCategory = str(pc)
  const partsType = str(pt)
  const partsSpin = str(psd)
  const partsOwnedOnly = powned === '1'
  const partsPage = pageNum(ppage)

  const [viewer, fx, catalog, partRows, inventoryRows] = await Promise.all([
    prisma.user.findUnique({ where: { id: viewerId }, select: { country: true } }),
    getRateTable(),
    searchBeyblades({
      q: catalogQ,
      page: catalogPage,
      take: KATALOG_PAGE_SIZE,
      manufacturer: catalogMf || null,
      type: catalogBt || null,
      ownedByUserId: ownedOnly ? viewerId : null,
    }),
    searchParts({
      q: partsQ,
      category: partsCategory || undefined,
      page: partsPage,
      take: PARTS_TAB_PAGE_SIZE,
      type: partsType || null,
      spinDirection: partsSpin || null,
      ownedByUserId: partsOwnedOnly ? viewerId : null,
    }),
    prisma.collectionItem.findMany({
      where: { userId: viewerId },
      orderBy: { id: 'asc' },
      take: PAGE_SIZE + 1,
      ...(typeof cursor === 'string' && cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true, purchasePrice: true, currency: true, merchant: true, boughtAt: true,
        // #160 — Herkunft (aus welchem Set stammt das Teil) statt Preis im Vordergrund; Bild
        // und Drehrichtung ergänzt (waren auf Part immer schon da, wurden hier nur nicht selektiert).
        sourceBeybladeId: true,
        sourceBeyblade: { select: { id: true, name: true } },
        part: { select: { id: true, name: true, category: true, manufacturer: true, imageId: true, spinDirection: true } },
      },
    }),
  ])

  // Batch-Aggregate für den Beyblades-Tab (ein groupBy für die ganze Seite, nie N Einzelqueries).
  const ratingRows = catalog.beyblades.length
    ? await prisma.rating.groupBy({
        by: ['targetId'],
        where: { targetType: 'BEYBLADE', targetId: { in: catalog.beyblades.map((b) => b.id) } },
        _avg: { stars: true },
        _count: true,
      })
    : []
  const beybladeRatings = shapeRatingAggregates(ratingRows)

  // Auto-Meta-Winrates für den Teile-Tab (ein Batch-mget, wie auf /search).
  const partStats = await getPartStats(partRows.parts.map((p) => p.id))
  const partGroups = groupPartsByCategory(partRows.parts)

  // #137 — "In Besitz"-Haken auf JEDER Karte, unabhängig vom "Nur im Besitz"-Filter: je ein
  // scoped Batch-Query über die IDs dieser Seite (nie N Einzelqueries pro Karte).
  const ownedBeybladeIds = catalog.beyblades.length
    ? new Set(
        (
          await prisma.purchase.findMany({
            where: { userId: viewerId, beybladeId: { in: catalog.beyblades.map((b) => b.id) } },
            select: { beybladeId: true },
            distinct: ['beybladeId'],
          })
        ).map((p) => p.beybladeId),
      )
    : new Set<string>()
  const ownedPartIds = partRows.parts.length
    ? new Set(
        (
          await prisma.collectionItem.findMany({
            where: { userId: viewerId, partOrBeyId: { in: partRows.parts.map((p) => p.id) } },
            select: { partOrBeyId: true },
            distinct: ['partOrBeyId'],
          })
        ).map((c) => c.partOrBeyId),
      )
    : new Set<string>()

  // No per-user currency preference exists in the schema — the hint target is inferred from
  // the viewer's country (CH → CHF, else EUR). See components/collection/PriceDisplay.tsx.
  const target: FxCurrency = viewer?.country === 'CH' ? 'CHF' : 'EUR'

  const hasMoreInventory = inventoryRows.length > PAGE_SIZE
  const items = hasMoreInventory ? inventoryRows.slice(0, PAGE_SIZE) : inventoryRows
  const nextInventoryCursor = hasMoreInventory ? items[items.length - 1]!.id : null
  // #160 — Gruppierung nach Teileart wie der Teile-Tab; groupPartsByCategory erwartet
  // `.category` am Element selbst, hier eine Ebene tiefer auf `.part`.
  const inventoryGroups = groupPartsByCategory(items.map((item) => ({ ...item, category: item.part.category })))

  const catalogFilterActive = Boolean(catalogQ || catalogMf || catalogBt || ownedOnly)
  // #155 — Basis-Params ohne Seite; buildCatalogHref hängt die Zielseite pro Link an.
  const catalogParams = new URLSearchParams({ tab: 'beyblades' })
  if (catalogQ) catalogParams.set('q', catalogQ)
  if (catalogMf) catalogParams.set('mf', catalogMf)
  if (catalogBt) catalogParams.set('bt', catalogBt)
  if (ownedOnly) catalogParams.set('owned', '1')
  const buildCatalogHref = (page: number) => {
    const p = new URLSearchParams(catalogParams)
    p.set('kpage', String(page))
    return `/collection?${p.toString()}`
  }

  const beybladesContent = (
    <div className="space-y-6">
      {/* GET-Formular: jede Filterkombination bleibt eine teilbare URL (EventsFilterBar-Muster). */}
      <form role="search" action="/collection" className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto_auto]">
        <input type="hidden" name="tab" value="beyblades" />
        <div>
          <label htmlFor="col-q" className="mb-1 block text-sm">{t.collection.beybladesSearchLabel}</label>
          <Input id="col-q" name="q" type="search" defaultValue={catalogQ} placeholder={t.collection.beybladesSearchPlaceholder} />
        </div>
        <div>
          <label htmlFor="col-mf" className="mb-1 block text-sm">{t.catalog.manufacturer}</label>
          <Select id="col-mf" name="mf" defaultValue={catalogMf}>
            <option value="">{t.catalog.manufacturerAll}</option>
            <option value="TT">{t.catalog.manufacturerTT}</option>
            <option value="HASBRO">{t.catalog.manufacturerHasbro}</option>
          </Select>
        </div>
        <div>
          <label htmlFor="col-bt" className="mb-1 block text-sm">{t.catalog.type}</label>
          <Select id="col-bt" name="bt" defaultValue={catalogBt}>
            <option value="">{t.catalog.typeAll}</option>
            {BEY_TYPES.map(({ value, labelKey }) => (
              <option key={value} value={value}>{t.catalog[labelKey]}</option>
            ))}
          </Select>
        </div>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input type="checkbox" name="owned" value="1" defaultChecked={ownedOnly} className="size-4 accent-x-cyan-text" />
          {t.catalog.ownedOnly}
        </label>
        <div className="flex gap-2">
          <button type="submit" className="rounded-md bg-x-cyan px-4 py-2 text-sm font-medium text-base-dark transition-colors hover:bg-x-cyan/85">
            {t.common.search}
          </button>
          {catalogFilterActive && (
            <Link href="/collection?tab=beyblades" className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium transition-colors hover:bg-current/5">
              {t.catalog.reset}
            </Link>
          )}
        </div>
      </form>

      {catalog.beyblades.length === 0 ? (
        <div className="space-y-3">
          <EmptyState
            title={catalogFilterActive ? t.collection.beybladesEmptyFilteredTitle : t.collection.beybladesEmptyTitle}
            description={catalogFilterActive ? t.collection.beybladesEmptyFilteredDescription : t.collection.beybladesEmptyDescription}
            action={catalogFilterActive ? (
              <Link href="/collection?tab=beyblades" className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium transition-colors hover:bg-current/5">
                {t.catalog.reset}
              </Link>
            ) : undefined}
          />
          {/* #145 — Suchlücke im offiziellen Katalog: Anlegen bleibt Curator-Sache, aber jede:r
              Angemeldete darf ein fehlendes Set vorschlagen (kind=BUILD → erzeugt beim
              Approval eine Beyblade-Zeile). Die Seite ist login-gegated, die CTA darf
              also immer interaktiv sein. */}
          {catalogQ !== '' && <CatalogProposalCTA defaultKind="BUILD" />}
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {catalog.beyblades.map((beyblade) => (
            <li key={beyblade.id}>
              <BeybladeCard beyblade={beyblade} rating={beybladeRatings.get(beyblade.id) ?? null} owned={ownedBeybladeIds.has(beyblade.id)} />
            </li>
          ))}
        </ul>
      )}
      {/* #155 — echte Seitenzahlen statt "Weitere laden". */}
      {catalog.totalPages !== null && (
        <Pagination page={catalog.page!} totalPages={catalog.totalPages} buildHref={buildCatalogHref} />
      )}
    </div>
  )

  // #137 — Filter ergänzt um Typ, Drehrichtung, "nur im Besitz" (Analogon zum Beyblades-Tab).
  const partsFilterActive = Boolean(partsQ || partsCategory || partsType || partsSpin || partsOwnedOnly)
  const partsParams = new URLSearchParams({ tab: 'teile' })
  if (partsQ) partsParams.set('pq', partsQ)
  if (partsCategory) partsParams.set('pc', partsCategory)
  if (partsType) partsParams.set('pt', partsType)
  if (partsSpin) partsParams.set('psd', partsSpin)
  if (partsOwnedOnly) partsParams.set('powned', '1')
  const buildPartsHref = (page: number) => {
    const p = new URLSearchParams(partsParams)
    p.set('ppage', String(page))
    return `/collection?${p.toString()}`
  }

  const partsContent = (
    <div className="space-y-6">
      <form role="search" action="/collection" className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto_auto_auto]">
        <input type="hidden" name="tab" value="teile" />
        <div>
          <label htmlFor="col-pq" className="mb-1 block text-sm">{t.collection.partsSearchLabel}</label>
          <Input id="col-pq" name="pq" type="search" defaultValue={partsQ} placeholder={t.collection.partsSearchPlaceholder} />
        </div>
        <div>
          <label htmlFor="col-pc" className="mb-1 block text-sm">{t.catalog.category}</label>
          <Select id="col-pc" name="pc" defaultValue={partsCategory}>
            <option value="">{t.catalog.categoryAll}</option>
            {PART_CATEGORY_ORDER.map((category) => (
              <option key={category} value={category}>{PART_CATEGORY_LABELS[category]}</option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="col-pt" className="mb-1 block text-sm">{t.catalog.type}</label>
          <Select id="col-pt" name="pt" defaultValue={partsType}>
            <option value="">{t.catalog.typeAll}</option>
            {BEY_TYPES.map(({ value, labelKey }) => (
              <option key={value} value={value}>{t.catalog[labelKey]}</option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="col-psd" className="mb-1 block text-sm">Drehrichtung</label>
          <Select id="col-psd" name="psd" defaultValue={partsSpin}>
            <option value="">Alle Drehrichtungen</option>
            <option value="RIGHT">Rechtsdrehend</option>
            <option value="LEFT">Linksdrehend</option>
          </Select>
        </div>
        <label className="flex h-10 items-center gap-2 text-sm">
          <input type="checkbox" name="powned" value="1" defaultChecked={partsOwnedOnly} className="size-4 accent-x-cyan-text" />
          {t.catalog.ownedOnly}
        </label>
        <button type="submit" className="rounded-md bg-x-cyan px-4 py-2 text-sm font-medium text-base-dark transition-colors hover:bg-x-cyan/85">
          {t.common.search}
        </button>
        {partsFilterActive && (
          <Link href="/collection?tab=teile" className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium transition-colors hover:bg-current/5">
            {t.catalog.reset}
          </Link>
        )}
      </form>

      {partRows.parts.length === 0 ? (
        <EmptyState
          title={partsFilterActive ? t.collection.partsEmptyFilteredTitle : t.collection.partsEmptyTitle}
          description={partsFilterActive ? t.collection.partsEmptyFilteredDescription : t.collection.partsEmptyDescription}
          action={partsFilterActive ? (
            <Link href="/collection?tab=teile" className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium transition-colors hover:bg-current/5">
              {t.catalog.reset}
            </Link>
          ) : undefined}
        />
      ) : (
        <div className="space-y-6">
          {partGroups.map((group) => (
            <section key={group.category} aria-label={group.category} className="space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                {/* #137 — lesbarer Name statt rohem Enum-Wert ("LOCK_CHIP"). */}
                <Badge tone="cyan">
                  {group.category in PART_CATEGORY_LABELS
                    ? PART_CATEGORY_LABELS[group.category as keyof typeof PART_CATEGORY_LABELS]
                    : group.category}
                </Badge>
                <span className="text-current/50">{group.parts.length}</span>
              </h3>
              <ul className="grid gap-3 sm:grid-cols-2">
                {group.parts.map((part) => (
                  <li key={part.id}>
                    <Card className="p-3">
                      {/* #164-Nachtrag — die Badges standen bisher NEBEN dem Namen in derselben
                          Zeile und drückten die Textspalte auf einer schmalen Karte bis auf
                          wenige Pixel zusammen; break-words (für den vollen Namen, #137) brach
                          dann buchstabenweise um. Jetzt wie BeybladeCard: Badges in einer
                          eigenen Zeile UNTER dem Namen, Bild/Textspalte shrink-0/min-w-0. */}
                      <Link href={`/parts/${part.id}`} className="flex items-center gap-3">
                        {part.imageId ? (
                          <Image
                            src={`/api/media/${part.imageId}`}
                            alt=""
                            width={40}
                            height={40}
                            sizes="40px"
                            className="h-10 w-10 shrink-0 rounded object-contain"
                          />
                        ) : (
                          <div aria-hidden="true" className="h-10 w-10 shrink-0 rounded bg-x-cyan/10" />
                        )}
                        <div className="min-w-0 flex-1">
                          {/* #137 — voller Teilename statt abgeschnitten; bricht bei Bedarf um. */}
                          <p className="font-medium break-words">{part.name}</p>
                          <p className="truncate text-sm text-current/60">
                            {part.manufacturer === 'TT' ? t.catalog.manufacturerTT : t.catalog.manufacturerHasbro}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-1">
                            {part.beyType && <TypeBadge type={part.beyType} />}
                            {ownedPartIds.has(part.id) && <Badge tone="green">✓ Im Besitz</Badge>}
                            <WinRateBadge stats={partStats.get(part.id) ?? null} />
                          </div>
                        </div>
                      </Link>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {/* #155 — echte Seitenzahlen statt "Weitere laden". */}
      {partRows.totalPages !== null && (
        <Pagination page={partRows.page!} totalPages={partRows.totalPages} buildHref={buildPartsHref} />
      )}
    </div>
  )

  const inventoryContent = (
    <div className="space-y-6">
      {neu === '1' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card>
            <h3 className="mb-3 text-sm font-semibold">{t.collection.addSingle}</h3>
            <CollectionItemForm />
          </Card>
          <Card>
            <h3 className="mb-3 text-sm font-semibold">{t.collection.markSet}</h3>
            <MarkSetPurchasedForm />
          </Card>
        </div>
      )}

      {items.length === 0 && neu !== '1' ? (
        <EmptyState
          title={t.collection.emptyTitle}
          description={t.collection.emptyDescription}
          action={
            <Link href="/collection?tab=inventar&neu=1" className="rounded-md bg-x-cyan px-4 py-2 text-sm font-medium text-base-dark transition-colors hover:bg-x-cyan/85">
              {t.collection.addFirst}
            </Link>
          }
        />
      ) : (
        // #160 — Gruppierung nach Teileart statt einer flachen Liste, dieselbe kanonische
        // Reihenfolge wie der Teile-Tab (groupPartsByCategory/PART_CATEGORY_LABELS).
        <div className="space-y-6">
          {inventoryGroups.map((group) => (
            <section key={group.category} aria-label={group.category} className="space-y-2">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <Badge tone="cyan">
                  {group.category in PART_CATEGORY_LABELS
                    ? PART_CATEGORY_LABELS[group.category as keyof typeof PART_CATEGORY_LABELS]
                    : group.category}
                </Badge>
                <span className="text-current/50">{group.parts.length}</span>
              </h3>
              {/* #164 — mehrere Karten passen nebeneinander, wie die anderen Tabs (Grid statt
                  einspaltiger Liste). */}
              <ul className="grid gap-3 sm:grid-cols-2">
                {group.parts.map((item) => (
                  <li key={item.id}>
                    <CollectionItemCard item={item} rates={fx.rates} stale={fx.stale} target={target} />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {nextInventoryCursor && (
        <Link href={`/collection?tab=inventar&cursor=${nextInventoryCursor}`} className="inline-block underline underline-offset-2">
          {t.collection.loadMore}
        </Link>
      )}
    </div>
  )

  const tabs: TabDef[] = [
    { id: 'beyblades', label: t.collection.tabBeyblades, content: beybladesContent },
    { id: 'teile', label: t.collection.tabParts, content: partsContent },
    { id: 'inventar', label: t.collection.tabInventory, content: inventoryContent },
  ]

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t.collection.heading}</h1>
        {items.length > 0 && (
          <Link href="/collection?tab=inventar&neu=1" className="rounded-md bg-x-cyan px-4 py-2 text-sm font-medium text-base-dark transition-colors hover:bg-x-cyan/85">
            {t.collection.addPart}
          </Link>
        )}
      </div>

      <Tabs tabs={tabs} defaultTab={activeTab} />
    </main>
  )
}
