// lib/beybladeSearch.ts (MVP4, #139/#141)
// Server-side Beyblade-Suche (offizielle Sets) für den Katalog-Tab der Sammlung (/collection?
// tab=katalog — seit dem Build-Split leben Sets im Beyblade-Modell, nicht mehr als offizielle
// Builds) und den Set-Picker (GET /api/beyblades, konsumiert von MarkSetPurchasedForm).
// Ein Query matcht eine Beyblade, wenn der Name ODER der productCode das Präfix trägt
// (case-insensitive). Cursor-paginiert nach derselben Listen-Endpunkt-Regel wie searchBuilds.
// type/spinDirection werden nicht gespeichert — sie kommen aus dem Blade-Teil (Ableitung in
// lib/assembly.ts, hier direkt über die mitgelieferte blade-Relation).
import { prisma } from '@/lib/db'

export const BEYBLADE_PAGE_SIZE = 20

const BEYBLADE_INCLUDE = {
  blade: { select: { id: true, name: true, imageId: true, beyType: true, spinDirection: true } },
  lockChip: { select: { id: true, name: true, beyType: true, spinDirection: true } },
  overBlade: { select: { id: true, name: true } },
  metalBlade: { select: { id: true, name: true } },
  assistBlade: { select: { id: true, name: true } },
  ratchet: { select: { id: true, name: true } },
  bit: { select: { id: true, name: true } },
} as const

export type BeybladeSearchRow = Awaited<ReturnType<typeof searchBeyblades>>['beyblades'][number]

export async function searchBeyblades(opts: { q?: string; cursor?: string | null; take?: number }) {
  const q = (opts.q ?? '').trim()
  const take = opts.take ?? BEYBLADE_PAGE_SIZE
  const rows = await prisma.beyblade.findMany({
    where: {
      AND: [
        ...(q
          ? [
              {
                // Name-Präfix ODER Hersteller-Artikelnummer-Präfix (z. B. "G0290").
                OR: [
                  { name: { startsWith: q, mode: 'insensitive' as const } },
                  { productCode: { startsWith: q, mode: 'insensitive' as const } },
                ],
              },
            ]
          : []),
      ],
    },
    orderBy: { id: 'asc' },
    take: take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    include: BEYBLADE_INCLUDE,
  })
  const hasMore = rows.length > take
  const beyblades = hasMore ? rows.slice(0, take) : rows
  const nextCursor = hasMore ? beyblades[beyblades.length - 1]!.id : null
  return { beyblades, nextCursor }
}
