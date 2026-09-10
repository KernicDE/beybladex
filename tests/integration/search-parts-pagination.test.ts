// tests/integration/search-parts-pagination.test.ts
// [RC2 #63] searchParts ordered by name but cursored on id alone — with equally-named parts
// that skipped/duplicated rows across pages. The fix sorts by (name asc, id asc) and pages with
// a manual cursor predicate in exactly that order. The test seeds FIVE parts with the IDENTICAL
// name (more than one page) plus a follow-up name group, paginates with take=2 until exhausted,
// and asserts the union is complete, duplicate-free and in exact (name, id) order — including
// the page boundary between the two name groups. CI-only (Postgres).
import { describe, it, expect } from 'vitest'
import { searchParts } from '@/lib/buildSearch'
import { prisma } from '@/lib/db'

describe('searchParts pagination with duplicate names', () => {
  it('paginates completely and in order across equally-named parts', async () => {
    const suffix = Date.now().toString(36)
    const q = `ZZRace${suffix}`
    // Same name 5× (spans 3 pages at take=2 — the old id-cursor drifted here), then a second
    // and third name group to exercise the (name > cursor.name) branch at the boundaries.
    const names = [
      ...Array(5).fill(`${q}A`),
      ...Array(2).fill(`${q}B`),
      `${q}C`,
    ]
    const created = await Promise.all(
      names.map((name) =>
        prisma.part.create({ data: { name, category: 'BLADE', manufacturer: 'TT', spinDirection: 'RIGHT' } }),
      ),
    )
    const createdIds = created.map((p) => p.id)

    const seen: string[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const page = await searchParts({ q, take: 2, cursor })
      expect(page.parts).toHaveLength(2) // 8 rows at take=2 → four full pages
      seen.push(...page.parts.map((p) => p.id))
      cursor = page.nextCursor
      pages++
    } while (cursor && pages < 10)

    expect(pages).toBe(4) // 8 rows at take=2
    expect(cursor).toBeNull()

    // No duplicates, no gaps: exactly the seeded ids, each once.
    expect([...seen].sort()).toEqual([...createdIds].sort())
    expect(new Set(seen).size).toBe(seen.length)

    // Exact (name asc, id asc) order across the whole walk.
    const expected = [...created].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)).map((p) => p.id)
    expect(seen).toEqual(expected)

    await prisma.part.deleteMany({ where: { id: { in: createdIds } } })
  })
})
