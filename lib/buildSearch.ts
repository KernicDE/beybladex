// lib/buildSearch.ts (Phase 5 Part A)
// Server-side build search, shared by /builds, /search's "Teile" section and the deck
// builder's part-picker (via /builds?q=…). A query matches a build when ANY of its three
// parts' names start with the prefix (case-insensitive) — the hard prerequisite for the
// deck-builder picker per [REVIEW-FIX: ux-product §8]. Cursor-paginated per [REVIEW-FIX: P3].
import { prisma } from '@/lib/db'

export const BUILD_PAGE_SIZE = 20

export async function searchBuilds(opts: { q?: string; cursor?: string | null; take?: number }) {
  const q = (opts.q ?? '').trim()
  const take = opts.take ?? BUILD_PAGE_SIZE
  const rows = await prisma.build.findMany({
    where: q
      ? {
          OR: [
            { blade: { name: { startsWith: q, mode: 'insensitive' } } },
            { ratchet: { name: { startsWith: q, mode: 'insensitive' } } },
            { bit: { name: { startsWith: q, mode: 'insensitive' } } },
          ],
        }
      : {},
    orderBy: { id: 'asc' },
    take: take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    include: {
      blade: { select: { id: true, name: true, imageUrl: true, beyType: true } },
      ratchet: { select: { id: true, name: true } },
      bit: { select: { id: true, name: true } },
    },
  })
  const hasMore = rows.length > take
  const builds = hasMore ? rows.slice(0, take) : rows
  return { builds, nextCursor: hasMore ? builds[builds.length - 1].id : null }
}

// Parts-catalog search for /search's Teile section: name prefix + category filter.
export const PART_PAGE_SIZE = 20

export async function searchParts(opts: { q?: string; category?: string; cursor?: string | null; take?: number }) {
  const q = (opts.q ?? '').trim()
  const take = opts.take ?? PART_PAGE_SIZE
  const rows = await prisma.part.findMany({
    where: {
      ...(q ? { name: { startsWith: q, mode: 'insensitive' } } : {}),
      ...(opts.category ? { category: opts.category as 'BLADE' | 'RATCHET' | 'BIT' | 'ACCESSORY' } : {}),
    },
    orderBy: { name: 'asc' },
    take: take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: { id: true, name: true, category: true, beyType: true, imageUrl: true, spinDirection: true, manufacturer: true },
  })
  const hasMore = rows.length > take
  const parts = hasMore ? rows.slice(0, take) : rows
  return { parts, nextCursor: hasMore ? parts[parts.length - 1].id : null }
}
