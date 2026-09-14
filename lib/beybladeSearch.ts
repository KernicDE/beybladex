// lib/beybladeSearch.ts (MVP4, #139/#141; #144 — IA/UX-Katalog-Filter)
// Server-side Beyblade-Suche (offizielle Sets) für den Beyblades-Tab der Sammlung
// (/collection?tab=beyblades — seit dem Build-Split leben Sets im Beyblade-Modell) und den
// Set-Picker (GET /api/beyblades, konsumiert von MarkSetPurchasedForm).
// Ein Query matcht eine Beyblade, wenn der Name, der productCode ODER der Name eines der
// 7 Teile das Präfix trägt (case-insensitive) — #144: die Teilcode-Suche ("4-60" findet alle
// Sets mit einem 4-60-Ratchet) nutzt denselben OR-Über-alle-Slots-Ansatz wie searchBuilds.
// Filter (#144): Hersteller, Typ (abgeleitet — blade ODER lockChip beyType, keine Spalte am
// Set) und "nur im Besitz" (Purchase-Subquery des Viewers). Cursor-paginiert nach derselben
// Listen-Endpunkt-Regel wie searchBuilds. type/spinDirection werden nicht gespeichert —
// sie kommen aus dem Blade-Teil (Ableitung in lib/assembly.ts, hier direkt über die
// mitgelieferte blade-Relation).
import { prisma } from '@/lib/db'
import { ASSEMBLY_PART_SLOTS } from '@/lib/assembly'
import type { BeyType, Manufacturer } from '@prisma/client'

export const BEYBLADE_PAGE_SIZE = 20

const BEYBLADE_INCLUDE = {
  blade: { select: { id: true, name: true, imageId: true, beyType: true, spinDirection: true } },
  lockChip: { select: { id: true, name: true, imageId: true, beyType: true, spinDirection: true } },
  overBlade: { select: { id: true, name: true } },
  metalBlade: { select: { id: true, name: true } },
  assistBlade: { select: { id: true, name: true } },
  ratchet: { select: { id: true, name: true } },
  bit: { select: { id: true, name: true } },
} as const

export type BeybladeSearchRow = Awaited<ReturnType<typeof searchBeyblades>>['beyblades'][number]

export interface SearchBeybladesOpts {
  q?: string
  /** @deprecated Issue #155 — die UI-Listen (Sammlung) nutzen jetzt `page` (echte Seitenzahlen);
   *  Cursor bleibt für Nicht-UI-Konsumenten der JSON-API (GET /api/beyblades) erhalten. */
  cursor?: string | null
  /** Issue #155 — 1-indexierte Seite. Gesetzt → skip/take-Pagination + COUNT-Query statt Cursor;
   *  liefert zusätzlich `totalCount`/`totalPages`. */
  page?: number
  take?: number
  /** Hersteller-Filter (Manufacturer-Code: TT|HASBRO). */
  manufacturer?: string | null
  /** Typ-Filter (abgeleitet: blade.beyType ODER lockChip.beyType bei Custom Line). */
  type?: string | null
  /** "Nur im Besitz" — nur Sets, für die der Viewer mindestens einen Purchase hat. */
  ownedByUserId?: string | null
}

function beybladeWhere(opts: SearchBeybladesOpts, q: string) {
  return {
    AND: [
      ...(q
        ? [
            {
              // Name-Präfix ODER Hersteller-Artikelnummer-Präfix (z. B. "G0290") ODER
              // Teilname-Präfix über alle 7 Slots (Teilcode-Suche, #144).
              OR: [
                { name: { startsWith: q, mode: 'insensitive' as const } },
                { productCode: { startsWith: q, mode: 'insensitive' as const } },
                ...ASSEMBLY_PART_SLOTS.map((slot) => ({ [slot]: { name: { startsWith: q, mode: 'insensitive' as const } } })),
              ],
            },
          ]
        : []),
      ...(opts.manufacturer ? [{ manufacturer: opts.manufacturer as Manufacturer }] : []),
      ...(opts.type
        ? [
            // Abgeleiteter Typ: Standard/Ratchet-Integrated trägt ihn am BLADE-Teil,
            // Custom Line am Lock Chip (deriveAssemblyTraits in lib/assembly.ts).
            { OR: [{ blade: { beyType: opts.type as BeyType } }, { lockChip: { beyType: opts.type as BeyType } }] },
          ]
        : []),
      ...(opts.ownedByUserId ? [{ purchases: { some: { userId: opts.ownedByUserId } } }] : []),
    ],
  }
}

export async function searchBeyblades(opts: SearchBeybladesOpts) {
  const q = (opts.q ?? '').trim()
  const take = opts.take ?? BEYBLADE_PAGE_SIZE
  const where = beybladeWhere(opts, q)

  // #155 — Seitenzahlen brauchen eine Gesamtzahl; skip/take statt Cursor. Bekannter Tradeoff
  // (skip wird bei großem Offset langsamer) ist bei dieser Katalog-Größe akzeptabel — dasselbe
  // Abwägen wie beim in-memory-Filter in searchBuilds' onlyMineUserId.
  if (opts.page !== undefined) {
    const page = Math.max(1, opts.page)
    const [rows, totalCount] = await Promise.all([
      prisma.beyblade.findMany({
        where,
        orderBy: { id: 'asc' },
        take,
        skip: (page - 1) * take,
        include: BEYBLADE_INCLUDE,
      }),
      prisma.beyblade.count({ where }),
    ])
    return { beyblades: rows, nextCursor: null, page, totalPages: Math.max(1, Math.ceil(totalCount / take)), totalCount }
  }

  const rows = await prisma.beyblade.findMany({
    where,
    orderBy: { id: 'asc' },
    take: take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    include: BEYBLADE_INCLUDE,
  })
  const hasMore = rows.length > take
  const beyblades = hasMore ? rows.slice(0, take) : rows
  const nextCursor = hasMore ? beyblades[beyblades.length - 1]!.id : null
  return { beyblades, nextCursor, page: null, totalPages: null, totalCount: null }
}
