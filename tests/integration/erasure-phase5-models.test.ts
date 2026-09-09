// tests/integration/erasure-phase5-models.test.ts
// Phase 5 Part A, Cross-Phase Regression Guard (privacy-dsgvo #3): the account-erasure matrix
// handles the models this phase made User-owned — CollectionItem (now FK'd to Part), Deck /
// DeckBuild, Rating (new userId), PartRequest, and TournamentParticipant (kept, link severed
// by anonymization — Art. 17(3)). CI-only (Postgres/Redis).
import { describe, it, expect, afterEach } from 'vitest'
import { eraseOrAnonymizeUser } from '@/lib/accountErasure'
import { prisma } from '@/lib/db'

const ids = {
  users: [] as string[], parts: [] as string[], builds: [] as string[], decks: [] as string[],
  collectionItems: [] as string[], ratings: [] as string[], requests: [] as string[],
  rulesets: [] as string[], tournaments: [] as string[], participants: [] as string[],
}

async function makeBuild(tag: string) {
  const suffix = Date.now().toString(36)
  const blade = await prisma.part.create({ data: { name: `er_blade_${tag}_${suffix}`, category: 'BLADE', manufacturer: 'TT', spinDirection: 'RIGHT' } })
  const ratchet = await prisma.part.create({ data: { name: `er_ratchet_${tag}_${suffix}`, category: 'RATCHET', manufacturer: 'TT', spinDirection: 'RIGHT' } })
  const bit = await prisma.part.create({ data: { name: `er_bit_${tag}_${suffix}`, category: 'BIT', manufacturer: 'TT', spinDirection: 'RIGHT' } })
  ids.parts.push(blade.id, ratchet.id, bit.id)
  const build = await prisma.build.create({ data: { bladeId: blade.id, ratchetId: ratchet.id, bitId: bit.id, type: 'ATTACK' } })
  ids.builds.push(build.id)
  return build
}

afterEach(async () => {
  await prisma.tournamentParticipant.deleteMany({ where: { id: { in: ids.participants } } })
  await prisma.collectionItem.deleteMany({ where: { id: { in: ids.collectionItems } } })
  await prisma.rating.deleteMany({ where: { id: { in: ids.ratings } } })
  await prisma.partRequest.deleteMany({ where: { id: { in: ids.requests } } })
  for (const id of ids.tournaments) await prisma.tournament.delete({ where: { id } }).catch(() => {})
  for (const id of ids.rulesets) await prisma.ruleset.delete({ where: { id } }).catch(() => {})
  for (const deckId of ids.decks) {
    await prisma.deckBuild.deleteMany({ where: { deckId } })
    await prisma.deck.delete({ where: { id: deckId } }).catch(() => {})
  }
  for (const id of ids.builds) await prisma.build.delete({ where: { id } }).catch(() => {})
  for (const id of ids.users) await prisma.user.delete({ where: { id } }).catch(() => {})
  for (const id of ids.parts) await prisma.part.delete({ where: { id } }).catch(() => {})
  await prisma.user.deleteMany({ where: { username: 'geloeschte-nutzer' } })
  for (const key of Object.keys(ids)) (ids[key as keyof typeof ids]).length = 0
})

describe('account erasure — Phase 5 models', () => {
  it('erases CollectionItem/Deck/DeckBuild/Rating/PartRequest and keeps the TournamentParticipant link anonymized', async () => {
    const suffix = Date.now().toString(36)
    const user = await prisma.user.create({ data: { username: `er_user_${suffix}`, passwordHash: 'x' } })
    const opponent = await prisma.user.create({ data: { username: `er_opp_${suffix}`, passwordHash: 'x' } })
    ids.users.push(user.id, opponent.id)

    const build = await makeBuild('main')
    const part = (await prisma.part.findFirst({ where: { id: { in: ids.parts } }, orderBy: { name: 'asc' } }))!

    const item = await prisma.collectionItem.create({ data: { userId: user.id, partOrBeyId: part.id, purchasePrice: 12.99 } })
    ids.collectionItems.push(item.id)
    const deck = await prisma.deck.create({ data: { title: 'Erasure-Deck', userId: user.id } })
    ids.decks.push(deck.id)
    await prisma.deckBuild.create({ data: { deckId: deck.id, buildId: build.id, position: 1 } })
    const rating = await prisma.rating.create({ data: { buildId: build.id, userId: user.id, stars: 4, comment: 'gut' } })
    ids.ratings.push(rating.id)
    const request = await prisma.partRequest.create({ data: { requestedById: user.id, name: `Wunschteil ${suffix}` } })
    ids.requests.push(request.id)

    // Art. 17(3) data: a tournament participant row must SURVIVE, stripped of PII by the
    // User row's own anonymization.
    const ruleset = await prisma.ruleset.create({
      data: { title: `Erasure Ruleset ${suffix}`, slug: `erasure-ruleset-${suffix}`, createdById: opponent.id },
    })
    ids.rulesets.push(ruleset.id)
    const tournament = await prisma.tournament.create({
      data: {
        title: `Erasure Turnier ${suffix}`, description: 'Erasure-Testturnier', startDate: new Date(), locationName: 'Arena', postalCode: '10115', city: 'Berlin', state: 'Berlin',
        latitude: 52.52, longitude: 13.405, rulesetId: ruleset.id, createdById: opponent.id,
      },
    })
    ids.tournaments.push(tournament.id)
    const participant = await prisma.tournamentParticipant.create({ data: { tournamentId: tournament.id, userId: user.id, deckId: deck.id } })
    ids.participants.push(participant.id)

    await eraseOrAnonymizeUser(user.id)

    // Personal rows: gone.
    expect(await prisma.collectionItem.findUnique({ where: { id: item.id } })).toBeNull()
    expect(await prisma.deck.findUnique({ where: { id: deck.id } })).toBeNull()
    expect(await prisma.deckBuild.findMany({ where: { deckId: deck.id } })).toEqual([])
    expect(await prisma.rating.findUnique({ where: { id: rating.id } })).toBeNull()
    expect(await prisma.partRequest.findUnique({ where: { id: request.id } })).toBeNull()

    // Legitimate-interest rows: survive, personal link severed (the User row is anonymized in place).
    const kept = await prisma.tournamentParticipant.findUnique({ where: { id: participant.id } })
    expect(kept).not.toBeNull()
    expect(kept!.userId).toBe(user.id)
    const anonymized = await prisma.user.findUnique({ where: { id: user.id } })
    expect(anonymized!.username).toBe(`geloescht_${user.id.slice(0, 8)}`)
    expect(anonymized!.email).toBeNull()

    // And the shared catalog rows other users reference are untouched.
    expect(await prisma.build.findUnique({ where: { id: build.id } })).not.toBeNull()
    expect(await prisma.part.count({ where: { id: { in: ids.parts } } })).toBe(ids.parts.length)
  })
})
