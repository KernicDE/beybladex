// lib/buildSearch.ts (Phase 5 Part A; RC16 #122 — variable Slot-Liste; MVP4 #141 — Build-Split:
// die Scope-Filter officialOnly/personalOnly entfallen — Builds sind seit dem Split ausschließlich
// persönliche Kombinationen, offizielle Sets leben im Beyblade-Modell und werden über
// lib/beybladeSearch.ts gesucht; #144 — publicOnly für die Öffentliche-Builds-Ansicht)
// Server-side build search, shared by /builds (Meine Builds + Öffentliche Builds), /search's
// "Teile" section and the deck builder's part-picker (via /builds?q=…). A query matches a
// build when ANY of its (1–6) parts' names start with the prefix (case-insensitive) — the
// hard prerequisite for the deck-builder picker per [REVIEW-FIX: ux-product §8].
// Cursor-paginated per [REVIEW-FIX: P3].
import { prisma } from '@/lib/db'
import { ASSEMBLY_PART_SLOTS } from '@/lib/assembly'
import type { BeyType, PartCategory } from '@prisma/client'

export const BUILD_PAGE_SIZE = 20

// RC16 (#122) — alle Part-Slots in fester Reihenfolge (Anzeige + Verfügbarkeitslogik).
// Kanonisch in lib/assembly.ts (ASSEMBLY_PART_SLOTS) — der Build-Name bleibt nur als
// Kompatibilitäts-Alias bestehen.
/** @deprecated Alias für ASSEMBLY_PART_SLOTS aus lib/assembly.ts. */
export const BUILD_PART_SLOTS = ASSEMBLY_PART_SLOTS

const BUILD_INCLUDE_FOR_SEARCH = {
  // `include` already pulls in every scalar column on Build itself (id, type, name,
  // visibility, creatorId, …) — only the RELATION fields need naming here.
  // #144 — Ersteller:in für die Öffentliche-Builds-Karte (null bei Vor-MVP4-Rows).
  creator: { select: { username: true } },
  blade: { select: { id: true, name: true, imageId: true, beyType: true } },
  lockChip: { select: { id: true, name: true } },
  overBlade: { select: { id: true, name: true } },
  metalBlade: { select: { id: true, name: true } },
  assistBlade: { select: { id: true, name: true } },
  ratchet: { select: { id: true, name: true } },
  bit: { select: { id: true, name: true } },
} as const

export interface SearchBuildsOpts {
  q?: string
  /** @deprecated Issue #155 — /builds nutzt jetzt `page`; Cursor bleibt für die JSON-API
   *  (GET /api/builds, Deck-Builder-Picker) erhalten. */
  cursor?: string | null
  /** Issue #155 — 1-indexierte Seite (nur zusammen mit `creatorId`/`publicOnly`/`type` sinnvoll
   *  — NICHT mit `onlyMineUserId`, siehe dessen Doku: dessen in-memory-Filter kann keine
   *  korrekte Gesamtzahl für Seitenzahlen liefern). */
  page?: number
  take?: number
  /**
   * "Nur meine Teile" (Phase 11 item 6, Deck-Builder-Teile-Picker): filtert NACH der
   * DB-Query in-memory auf Builds, deren Teile ALLE im Besitz der Nutzerin/des Nutzers sind
   * (CollectionItem) — eine Verfügbarkeits-, keine Eigentümerschafts-Frage. NICHT verwechseln
   * mit `creatorId` unten (#153-Fix): ein frisch erstellter Build gehört seiner Erstellerin,
   * auch wenn sie die Teile noch nicht als "im Besitz" markiert hat.
   */
  onlyMineUserId?: string | null
  /**
   * "Meine Builds" (#144/#153): DB-seitiger Filter auf Build.creatorId — die tatsächliche
   * Eigentümerschaft des Build-Datensatzes, unabhängig vom Teile-Besitz.
   */
  creatorId?: string | null
  /** #144 — nur visibility=PUBLIC (Öffentliche-Builds-Ansicht). */
  publicOnly?: boolean
  /** #144 — Typ-Filter (Build.type ist eine echte Spalte). */
  type?: string | null
}

function buildSearchWhere(opts: SearchBuildsOpts, q: string) {
  return {
    AND: [
      ...(q
        ? [
            {
              // RC16 (#122) — OR über alle 7 Slot-Relationen: CX-Builds matchen auf Lock Chip /
              // Over / Metal / Assist Blade, Ratchet-Integrated auf Blade + Bit.
              OR: ASSEMBLY_PART_SLOTS.map((slot) => ({ [slot]: { name: { startsWith: q, mode: 'insensitive' } } })),
            },
          ]
        : []),
      ...(opts.publicOnly ? [{ visibility: 'PUBLIC' as const }] : []),
      ...(opts.type ? [{ type: opts.type as BeyType }] : []),
      ...(opts.creatorId ? [{ creatorId: opts.creatorId }] : []),
    ],
  }
}

export async function searchBuilds(opts: SearchBuildsOpts) {
  const q = (opts.q ?? '').trim()
  const take = opts.take ?? BUILD_PAGE_SIZE
  const where = buildSearchWhere(opts, q)

  // #155 — Seitenzahlen: skip/take + COUNT statt Cursor. Nur für die creatorId/publicOnly/type-
  // Fälle (siehe SearchBuildsOpts.page-Doku) — onlyMineUserId bleibt cursor-only.
  if (opts.page !== undefined && !opts.onlyMineUserId) {
    const pageNum = Math.max(1, opts.page)
    const [rows, totalCount] = await Promise.all([
      prisma.build.findMany({
        where,
        orderBy: { id: 'asc' },
        take,
        skip: (pageNum - 1) * take,
        include: BUILD_INCLUDE_FOR_SEARCH,
      }),
      prisma.build.count({ where }),
    ])
    return { builds: rows, nextCursor: null, page: pageNum, totalPages: Math.max(1, Math.ceil(totalCount / take)), totalCount }
  }

  const rows = await prisma.build.findMany({
    where,
    orderBy: { id: 'asc' },
    take: take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    include: BUILD_INCLUDE_FOR_SEARCH,
  })
  const hasMore = rows.length > take
  const page = hasMore ? rows.slice(0, take) : rows
  const nextCursor = hasMore ? page[page.length - 1].id : null

  if (!opts.onlyMineUserId) return { builds: page, nextCursor, page: null, totalPages: null, totalCount: null }

  // Phase 11 (item 6): "nur meine Teile" — a build is available when the caller owns (via
  // CollectionItem, jede Provenienz — sourceBeybladeId oder none) EVERY ONE of its constituent
  // parts (RC16 #122: je nach Bauform 2–6, leere Slots zählen nicht). One query for the
  // owned-part-id set, then
  // a pure in-memory filter/annotate over this page's builds.
  // [RC5 #58] Only the id column, DISTINCT: a large collection (many rows per part from
  // repeated purchases/set provenance) previously shipped every duplicate row across the wire.
  // Known tradeoff: filtering happens AFTER cursor pagination, so a page can return fewer than
  // `take` results (or zero) even when more available builds exist further in — acceptable at
  // this catalog's realistic size; a DB-level filter would need a raw-SQL subquery.
  const owned = await prisma.collectionItem.findMany({
    where: { userId: opts.onlyMineUserId },
    select: { partOrBeyId: true },
    distinct: ['partOrBeyId'],
  })
  const ownedIds = new Set(owned.map((o) => o.partOrBeyId))
  const withAvailability = page.map((b) => ({
    ...b,
    available: ASSEMBLY_PART_SLOTS.every((slot) => {
      const id = b[`${slot}Id`]
      return id === null || ownedIds.has(id)
    }),
  }))
  const builds = withAvailability.filter((b) => b.available)
  return { builds, nextCursor, page: null, totalPages: null, totalCount: null }
}

// Parts-catalog search for /search's Teile section: name prefix + category filter.
export const PART_PAGE_SIZE = 20

const PART_SEARCH_SELECT = { id: true, name: true, category: true, beyType: true, imageId: true, spinDirection: true, manufacturer: true } as const

export interface SearchPartsOpts {
  q?: string
  category?: string
  /** @deprecated Issue #155 — der Teile-Tab nutzt jetzt `page`; Cursor bleibt für Nicht-UI-
   *  Konsumenten (falls je einer entsteht) erhalten. */
  cursor?: string | null
  /** Issue #155 — 1-indexierte Seite. skip/take auf der ohnehin stabilen (name,id)-Sortierung
   *  braucht anders als der Cursor-Zweig KEINE manuelle Cursor-Zeile. */
  page?: number
  take?: number
  /** #137 — Typ-Filter für den Teile-Tab der Sammlung (nur BLADE/LOCK_CHIP tragen einen Typ). */
  type?: string | null
  /** #137 — Drehrichtungs-Filter für den Teile-Tab. */
  spinDirection?: string | null
  /**
   * #137 — "Nur im Besitz": DB-seitiger Filter auf CollectionItem des Viewers (Teile-Tab-
   * Äquivalent zu searchBeyblades' ownedByUserId). Anders als searchBuilds' onlyMineUserId
   * (in-memory, weil dort eine Kombination AUS mehreren Teilen geprüft wird) ist ein einzelnes
   * Teil trivial entweder besessen oder nicht — passt als WHERE-Klausel vor die Pagination,
   * ohne deren cursor-Korrektheit zu gefährden.
   */
  ownedByUserId?: string | null
}

export async function searchParts(opts: SearchPartsOpts) {
  const q = (opts.q ?? '').trim()
  const take = opts.take ?? PART_PAGE_SIZE
  let ownedIds: string[] | null = null
  if (opts.ownedByUserId) {
    const owned = await prisma.collectionItem.findMany({
      where: { userId: opts.ownedByUserId },
      select: { partOrBeyId: true },
      distinct: ['partOrBeyId'],
    })
    ownedIds = owned.map((o) => o.partOrBeyId)
  }
  const baseWhere = {
    AND: [
      ...(q ? [{ name: { startsWith: q, mode: 'insensitive' as const } }] : []),
      ...(opts.category ? [{ category: opts.category as PartCategory }] : []),
      ...(opts.type ? [{ beyType: opts.type as BeyType }] : []),
      ...(opts.spinDirection ? [{ spinDirection: opts.spinDirection as 'RIGHT' | 'LEFT' }] : []),
      ...(ownedIds ? [{ id: { in: ownedIds } }] : []),
    ],
  }

  if (opts.page !== undefined) {
    const pageNum = Math.max(1, opts.page)
    const [rows, totalCount] = await Promise.all([
      prisma.part.findMany({
        where: baseWhere,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take,
        skip: (pageNum - 1) * take,
        select: PART_SEARCH_SELECT,
      }),
      prisma.part.count({ where: baseWhere }),
    ])
    return { parts: rows, nextCursor: null, page: pageNum, totalPages: Math.max(1, Math.ceil(totalCount / take)), totalCount }
  }

  // [RC2 #63] Composite sort name+id with a MANUAL cursor predicate. The old query ordered by
  // name but cursored on id alone (Prisma: cursor + skip:1) — with equally-named parts that
  // combination drifts: skip-by-id skips past same-name rows on the next page (gaps) or
  // re-reads them (duplicates). Sorting and paging now share the same key: rows come back in
  // (name asc, id asc) and the next page is everything AFTER the cursor row in exactly that
  // order — (name > cursor.name) OR (name = cursor.name AND id > cursor.id).
  let cursorRow: { id: string; name: string } | null = null
  if (opts.cursor) {
    cursorRow = await prisma.part.findUnique({ where: { id: opts.cursor }, select: { id: true, name: true } })
  }
  const rows = await prisma.part.findMany({
    where: {
      AND: [
        ...baseWhere.AND,
        ...(cursorRow
          ? [{ OR: [{ name: { gt: cursorRow.name } }, { name: cursorRow.name, id: { gt: cursorRow.id } }] }]
          : []),
      ],
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: take + 1,
    select: PART_SEARCH_SELECT,
  })
  const hasMore = rows.length > take
  const parts = hasMore ? rows.slice(0, take) : rows
  return { parts, nextCursor: hasMore ? parts[parts.length - 1].id : null, page: null, totalPages: null, totalCount: null }
}

// #144 — Teile-Tab der Sammlung: feste Anzeigereihenfolge der Kategorien (Assembly-Ordnung,
// ACCESSORY zuletzt) und Gruppierung der Suchergebnisse danach.
export const PART_CATEGORY_ORDER = ['BLADE', 'LOCK_CHIP', 'OVER_BLADE', 'METAL_BLADE', 'ASSIST_BLADE', 'RATCHET', 'BIT', 'ACCESSORY'] as const

// #137 — Kategorie-Badge in der Sammlung zeigte den rohen Enum-Wert (z. B. "LOCK_CHIP") statt
// eines lesbaren Namens. Dieselben deutschen Bezeichnungen wie components/admin/PartForm.tsx,
// hier zentral, damit beide Stellen nicht auseinanderdriften.
export const PART_CATEGORY_LABELS: Record<(typeof PART_CATEGORY_ORDER)[number], string> = {
  BLADE: 'Blade',
  LOCK_CHIP: 'Lock Chip (CX)',
  OVER_BLADE: 'Over Blade (CX)',
  METAL_BLADE: 'Metal Blade (CX)',
  ASSIST_BLADE: 'Assist Blade (CX)',
  RATCHET: 'Ratchet',
  BIT: 'Bit',
  ACCESSORY: 'Zubehör',
}

export interface PartGroup<T extends { category: string }> {
  category: string
  parts: T[]
}

/** Gruppiert Teile nach Kategorie in der kanonischen PART_CATEGORY_ORDER (nur belegte Gruppen;
 *  unbekannte Kategorien — z. B. ein künftiger Enum-Wert — landen anschließend in Map-Reihenfolge). */
export function groupPartsByCategory<T extends { category: string }>(parts: T[]): PartGroup<T>[] {
  const groups = new Map<string, T[]>()
  for (const part of parts) {
    const list = groups.get(part.category)
    if (list) list.push(part)
    else groups.set(part.category, [part])
  }
  const ordered = PART_CATEGORY_ORDER.filter((category) => groups.has(category))
  const leftovers = [...groups.keys()].filter((category) => !(PART_CATEGORY_ORDER as readonly string[]).includes(category))
  return [...ordered, ...leftovers].map((category) => ({ category, parts: groups.get(category)! }))
}
