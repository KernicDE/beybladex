// tests/unit/build-search-scope.test.ts (RC16 #102/#104)
// Rollenverteilung Katalog vs. eigene Builds: searchBuilds bekommt zwei neue Scope-Filter —
// officialOnly (nur offizielle Sets, Katalog-Tab der Sammlung) und personalOnly (nur
// nicht-offizielle Kombis, /builds). Seams mocked on '@/' imports, kein echtes DB.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: {
    build: { findMany: vi.fn() },
    collectionItem: { findMany: vi.fn() },
  },
}))

import { prisma } from '@/lib/db'
import { searchBuilds, BUILD_PART_SLOTS } from '@/lib/buildSearch'

const buildFindMany = vi.mocked(prisma.build.findMany)

beforeEach(() => {
  vi.clearAllMocks()
  buildFindMany.mockResolvedValue([] as never)
})

describe('searchBuilds Scope-Filter (#104)', () => {
  it('personalOnly filtert auf isOfficialSet: false (nur eigene Kombis auf /builds)', async () => {
    await searchBuilds({ personalOnly: true })

    const call = buildFindMany.mock.calls[0][0] as { where: { AND: Record<string, unknown>[] } }
    expect(call.where.AND).toContainEqual({ isOfficialSet: false })
  })

  it('ohne Scope-Filter keine isOfficialSet-Bedingung (Deck-Builder/API bleiben unberührt)', async () => {
    await searchBuilds({})

    const call = buildFindMany.mock.calls[0][0] as { where: { AND: Record<string, unknown>[] } }
    expect(JSON.stringify(call.where.AND)).not.toContain('isOfficialSet')
  })

  it('kombiniert die q-Prefix-Suche über alle 7 Slots mit dem Scope', async () => {
    await searchBuilds({ q: 'Dran', personalOnly: true })

    const call = buildFindMany.mock.calls[0][0] as { where: { AND: Array<{ OR?: unknown[]; isOfficialSet?: boolean }> } }
    const orClause = call.where.AND.find((c) => Array.isArray(c.OR))
    expect(orClause?.OR).toHaveLength(BUILD_PART_SLOTS.length)
    expect(call.where.AND).toContainEqual({ isOfficialSet: false })
  })
})
