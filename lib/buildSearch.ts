// lib/buildSearch.ts (Phase 5 Part A; RC16 #122 — variable Slot-Liste; MVP4 #141 — Build-Split:
// die Scope-Filter officialOnly/personalOnly entfallen — Builds sind seit dem Split ausschließlich
// persönliche Kombinationen, offizielle Sets leben im Beyblade-Modell und werden über
// lib/beybladeSearch.ts gesucht)
// Server-side build search, shared by /builds (nur eigene Kombis), /search's "Teile" section
// and the deck builder's part-picker (via /builds?q=…). A query matches a build when ANY of
// its (1–6) parts' names start with the prefix (case-insensitive) — the hard prerequisite for
// the deck-builder picker per [REVIEW-FIX: ux-product §8]. Cursor-paginated per [REVIEW-FIX: P3].
import { prisma } from '@/lib/db'
import { ASSEMBLY_PART_SLOTS } from '@/lib/assembly'
import type { PartCategory } from '@prisma/client'

export const BUILD_PAGE_SIZE = 20

// RC16 (#122) — alle Part-Slots in fester Reihenfolge (Anzeige + Verfügbarkeitslogik).
// Kanonisch in lib/assembly.ts (ASSEMBLY_PART_SLOTS) — der Build-Name bleibt nur als
// Kompatibilitäts-Alias bestehen.
/** @deprecated Alias für ASSEMBLY_PART_SLOTS aus lib/assembly.ts. */
export const BUILD_PART_SLOTS = ASSEMBLY_PART_SLOTS

export async function searchBuilds(opts: { q?: string; cursor?: string | null; take?: number; onlyMineUserId?: string | null }) {
  const q = (opts.q ?? '').trim()
  const take = opts.take ?? BUILD_PAGE_SIZE
  const rows = await prisma.build.findMany({
    where: {
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
      ],
    },
    orderBy: { id: 'asc' },
    take: take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    include: {
      // `include` already pulls in every scalar column on Build itself (id, type, name,
      // visibility, imageId, …) — only the RELATION fields need naming here.
      blade: { select: { id: true, name: true, imageId: true, beyType: true } },
      lockChip: { select: { id: true, name: true } },
      overBlade: { select: { id: true, name: true } },
      metalBlade: { select: { id: true, name: true } },
      assistBlade: { select: { id: true, name: true } },
      ratchet: { select: { id: true, name: true } },
      bit: { select: { id: true, name: true } },
    },
  })
  const hasMore = rows.length > take
  const page = hasMore ? rows.slice(0, take) : rows
  const nextCursor = hasMore ? page[page.length - 1].id : null

  if (!opts.onlyMineUserId) return { builds: page, nextCursor }

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
  return { builds, nextCursor }
}

// Parts-catalog search for /search's Teile section: name prefix + category filter.
export const PART_PAGE_SIZE = 20

export async function searchParts(opts: { q?: string; category?: string; cursor?: string | null; take?: number }) {
  const q = (opts.q ?? '').trim()
  const take = opts.take ?? PART_PAGE_SIZE
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
        ...(q ? [{ name: { startsWith: q, mode: 'insensitive' as const } }] : []),
        ...(opts.category ? [{ category: opts.category as PartCategory }] : []),
        ...(cursorRow
          ? [{ OR: [{ name: { gt: cursorRow.name } }, { name: cursorRow.name, id: { gt: cursorRow.id } }] }]
          : []),
      ],
    },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: take + 1,
    select: { id: true, name: true, category: true, beyType: true, imageId: true, spinDirection: true, manufacturer: true },
  })
  const hasMore = rows.length > take
  const parts = hasMore ? rows.slice(0, take) : rows
  return { parts, nextCursor: hasMore ? parts[parts.length - 1].id : null }
}
