// tests/integration/deck-duplicate-db-constraint.test.ts
// Phase 5 Part A: the DeckBuild schema change — @@id([deckId, position]) plus
// @@unique([deckId, buildId]). Inserting two DeckBuild rows with the same buildId for one
// deckId directly against Prisma must throw a unique-constraint error (P2002): the DB-layer
// backstop works even if application-level deck validation is bypassed. CI-only.
import { describe, it, expect, afterEach } from 'vitest'
import { prisma } from '@/lib/db'

const ids = { users: [] as string[], decks: [] as string[], builds: [] as string[], parts: [] as string[] }

async function makePart(name: string, category: 'BLADE' | 'RATCHET' | 'BIT') {
  const part = await prisma.part.create({
    data: { name, category, manufacturer: 'TT', spinDirection: 'RIGHT' },
  })
  ids.parts.push(part.id)
  return part
}

async function makeBuild(tag: string) {
  const suffix = Date.now().toString(36)
  const blade = await makePart(`ddc_blade_${tag}_${suffix}`, 'BLADE')
  const ratchet = await makePart(`ddc_ratchet_${tag}_${suffix}`, 'RATCHET')
  const bit = await makePart(`ddc_bit_${tag}_${suffix}`, 'BIT')
  const build = await prisma.build.create({
    data: { bladeId: blade.id, ratchetId: ratchet.id, bitId: bit.id, type: 'ATTACK' },
  })
  ids.builds.push(build.id)
  return build
}

afterEach(async () => {
  await prisma.deckBuild.deleteMany({ where: { deckId: { in: ids.decks } } })
  for (const id of ids.builds) await prisma.build.delete({ where: { id } }).catch(() => {})
  for (const id of ids.decks) await prisma.deck.delete({ where: { id } }).catch(() => {})
  for (const id of ids.users) await prisma.user.delete({ where: { id } }).catch(() => {})
  for (const id of ids.parts) await prisma.part.delete({ where: { id } }).catch(() => {})
  for (const key of Object.keys(ids)) (ids[key as keyof typeof ids]).length = 0
})

describe('DeckBuild DB-layer constraints', () => {
  it('two DeckBuild rows with the same buildId for one deckId throw a unique-constraint error', async () => {
    const suffix = Date.now().toString(36)
    const user = await prisma.user.create({ data: { username: `ddc_usr_${suffix}`, passwordHash: 'x' } })
    ids.users.push(user.id)
    const deck = await prisma.deck.create({ data: { title: 'Constraint-Test', userId: user.id } })
    ids.decks.push(deck.id)
    const build = await makeBuild('a')

    await prisma.deckBuild.create({ data: { deckId: deck.id, buildId: build.id, position: 1 } })
    // Same build at a DIFFERENT position — what a racing/malicious client would attempt.
    await expect(
      prisma.deckBuild.create({ data: { deckId: deck.id, buildId: build.id, position: 2 } }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  it('the same buildId in two DIFFERENT decks is fine, and (deckId, position) is the row identity', async () => {
    const suffix = Date.now().toString(36)
    const user = await prisma.user.create({ data: { username: `ddc_usr2_${suffix}`, passwordHash: 'x' } })
    ids.users.push(user.id)
    const deckA = await prisma.deck.create({ data: { title: 'Deck A', userId: user.id } })
    const deckB = await prisma.deck.create({ data: { title: 'Deck B', userId: user.id } })
    ids.decks.push(deckA.id, deckB.id)
    const build = await makeBuild('b')

    await prisma.deckBuild.create({ data: { deckId: deckA.id, buildId: build.id, position: 1 } })
    await prisma.deckBuild.create({ data: { deckId: deckB.id, buildId: build.id, position: 1 } })
    // Reusing (deckId, position) is rejected because position is part of the primary key.
    await expect(
      prisma.deckBuild.create({ data: { deckId: deckA.id, buildId: build.id, position: 1 } }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })
})
