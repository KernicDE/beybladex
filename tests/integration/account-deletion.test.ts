// tests/integration/account-deletion.test.ts
// Task 12: DELETE /api/account + lib/accountErasure.ts (GDPR Art. 17). Integration — CI-only
// (Postgres/Redis). Seeds a user owning a club (with another admin), a solo club, a ruleset,
// a deck, and a completed match; asserts PII gone, username released, club reassigned-or-
// dissolved, ruleset reassigned to the system user, and other users' legitimate data surviving.
import { describe, it, expect, vi, afterEach } from 'vitest'
import bcrypt from 'bcryptjs'
import { authenticator } from 'otplib'
import { DELETE } from '@/app/api/account/route'
import { eraseOrAnonymizeUser } from '@/lib/accountErasure'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'
import { encryptSecret } from '@/lib/totpEncryption'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

type Ids = {
  users: string[]; clubs: string[]; rulesets: string[]; tournaments: string[]
  decks: string[]; builds: string[]; matches: string[]; participants: string[]
  friendships: string[]; collectionItems: string[]; notifications: string[]; passkeys: string[]
}

async function cleanup(ids: Ids) {
  for (const id of ids.matches) await prisma.match.delete({ where: { id } }).catch(() => {})
  for (const id of ids.participants) await prisma.tournamentParticipant.delete({ where: { id } }).catch(() => {})
  for (const id of ids.friendships) await prisma.friendship.delete({ where: { id } }).catch(() => {})
  for (const id of ids.notifications) await prisma.notification.delete({ where: { id } }).catch(() => {})
  for (const id of ids.collectionItems) await prisma.collectionItem.delete({ where: { id } }).catch(() => {})
  for (const id of ids.passkeys) await prisma.passkey.delete({ where: { id } }).catch(() => {})
  for (const deckId of ids.decks) {
    await prisma.deckBuild.deleteMany({ where: { deckId } })
    await prisma.deck.delete({ where: { id: deckId } }).catch(() => {})
  }
  for (const id of ids.builds) await prisma.build.delete({ where: { id } }).catch(() => {})
  for (const id of ids.tournaments) await prisma.tournament.delete({ where: { id } }).catch(() => {})
  for (const id of ids.clubs) await prisma.club.delete({ where: { id } }).catch(() => {})
  for (const id of ids.rulesets) await prisma.ruleset.delete({ where: { id } }).catch(() => {})
  for (const id of ids.users) await prisma.user.delete({ where: { id } }).catch(() => {})
  for (const key of Object.keys(ids)) (ids[key as keyof Ids]).length = 0
  // the erasure matrix creates this shared row; remove it if a test left it behind
  await prisma.user.deleteMany({ where: { username: 'geloeschte-nutzer' } })
}

async function seedRichUser(suffix: string) {
  const passwordHash = await bcrypt.hash('correct horse battery staple', 12)
  const owner = await prisma.user.create({
    data: {
      username: `del_${suffix}`,
      passwordHash,
      email: 'owner@example.de',
      displayName: 'Weg Damit',
      bio: 'Ich lösche mich',
      city: 'Dresden',
      postalCode: '01067',
      discordTag: 'owner#0001',
      birthDate: new Date('1991-05-05'),
      isMinor: false,
    },
  })
  const admin = await prisma.user.create({ data: { username: `deladm_${suffix}`, passwordHash } })
  const opponent = await prisma.user.create({ data: { username: `delopp_${suffix}`, passwordHash } })

  const ids: Ids = {
    users: [owner.id, admin.id, opponent.id],
    clubs: [], rulesets: [], tournaments: [], decks: [], builds: [], matches: [],
    participants: [], friendships: [], collectionItems: [], notifications: [], passkeys: [],
  }

  // club with another admin member (must be reassigned, not dissolved)
  const sharedClub = await prisma.club.create({
    data: {
      name: `Del Club ${suffix}`,
      slug: `del-club-${suffix}`,
      ownerId: owner.id,
      members: { create: [{ userId: admin.id, isAdmin: true }] },
    },
  })
  ids.clubs.push(sharedClub.id)
  // solo club (must be dissolved)
  const soloClub = await prisma.club.create({
    data: { name: `Del Solo ${suffix}`, slug: `del-solo-${suffix}`, ownerId: owner.id },
  })
  ids.clubs.push(soloClub.id)

  const ruleset = await prisma.ruleset.create({
    data: { title: `Del Ruleset ${suffix}`, slug: `del-ruleset-${suffix}`, createdById: owner.id },
  })
  ids.rulesets.push(ruleset.id)
  const tournament = await prisma.tournament.create({
    data: {
      title: `Del Turnier ${suffix}`,
      description: 'Lösch-Test',
      startDate: new Date('2027-02-01T10:00:00Z'),
      locationName: 'Arena',
      postalCode: '01067',
      city: 'Dresden',
      state: 'Sachsen',
      latitude: 51.05,
      longitude: 13.74,
      rulesetId: ruleset.id,
    },
  })
  ids.tournaments.push(tournament.id)
  const build = await prisma.build.create({ data: { bladeId: 'blade-x', ratchetId: 'ratchet-x', bitId: 'bit-x' } })
  ids.builds.push(build.id)
  const deck = await prisma.deck.create({ data: { title: 'Del-Deck', userId: owner.id } })
  ids.decks.push(deck.id)
  await prisma.deckBuild.create({ data: { deckId: deck.id, buildId: build.id, position: 1 } })
  const participant = await prisma.tournamentParticipant.create({
    data: { tournamentId: tournament.id, userId: owner.id, deckId: deck.id, checkedIn: true },
  })
  ids.participants.push(participant.id)
  const match = await prisma.match.create({
    data: {
      tournamentId: tournament.id,
      judgeId: admin.id,
      player1Id: owner.id,
      player2Id: opponent.id,
      player1BuildId: build.id,
      scorePlayer1: 4,
      scorePlayer2: 2,
      winnerId: owner.id,
    },
  })
  ids.matches.push(match.id)
  const friendship = await prisma.friendship.create({ data: { requesterId: owner.id, addresseeId: admin.id, status: 'ACCEPTED' } })
  ids.friendships.push(friendship.id)
  const item = await prisma.collectionItem.create({ data: { userId: owner.id, partOrBeyId: 'part-del' } })
  ids.collectionItems.push(item.id)
  const notification = await prisma.notification.create({ data: { userId: owner.id, title: 'Bye', message: 'Löschung' } })
  ids.notifications.push(notification.id)
  const passkey = await prisma.passkey.create({
    data: { userId: owner.id, credentialId: `cred-${suffix}`, publicKey: 'key', counter: 0 },
  })
  ids.passkeys.push(passkey.id)

  return { owner, admin, opponent, sharedClub, soloClub, ruleset, tournament, build, deck, match, ids }
}

describe('account deletion (Art. 17)', () => {
  afterEach(() => {
    mockAuth.mockReset()
  })

  it('DELETE /api/account erases PII, releases the username, reassigns-or-dissolves clubs, reassigns rulesets, and keeps other users\' data intact', async () => {
    const { owner, admin, sharedClub, soloClub, ruleset, tournament, build, deck, match, ids } = await seedRichUser(Date.now().toString(36))

    mockAuth.mockResolvedValue(asSession({ id: owner.id, name: owner.username }))

    // wrong password is refused, nothing is erased
    const wrong = await DELETE(new Request('http://localhost/api/account', {
      method: 'DELETE',
      body: JSON.stringify({ password: 'falsches passwort' }),
    }))
    expect(wrong.status).toBe(403)
    expect((await prisma.user.findUnique({ where: { id: owner.id } }))!.email).toBe('owner@example.de')

    // missing confirmation is a 400
    const missing = await DELETE(new Request('http://localhost/api/account', {
      method: 'DELETE',
      body: JSON.stringify({}),
    }))
    expect(missing.status).toBe(400)

    const res = await DELETE(new Request('http://localhost/api/account', {
      method: 'DELETE',
      body: JSON.stringify({ password: 'correct horse battery staple' }),
    }))
    expect(res.status).toBe(200)

    // PII is gone from the User row; username is anonymized and RELEASED (@unique free again)
    const anonymized = await prisma.user.findUnique({ where: { id: owner.id } })
    expect(anonymized!.username).toBe(`geloescht_${owner.id.slice(0, 8)}`)
    expect(anonymized!.displayName).toBe('Gelöschter Nutzer')
    for (const field of ['email', 'passwordHash', 'bio', 'discordTag', 'city', 'postalCode', 'birthDate', 'totpSecret', 'parentalConsentEmail', 'latitude', 'longitude'] as const) {
      expect(anonymized![field]).toBeNull()
    }
    await prisma.user.create({ data: { username: owner.username, passwordHash: 'x' } }) // throws if not released
    const reregistered = await prisma.user.findUnique({ where: { username: owner.username } })
    expect(reregistered).not.toBeNull()
    ids.users.push(reregistered!.id)

    // club with another admin: reassigned, not dissolved; solo club: dissolved
    const reassigned = await prisma.club.findUnique({ where: { id: sharedClub.id } })
    expect(reassigned).not.toBeNull()
    expect(reassigned!.ownerId).toBe(admin.id)
    expect(await prisma.club.findUnique({ where: { id: soloClub.id } })).toBeNull()

    // ruleset survives, reassigned to the reserved system user
    const survivingRuleset = await prisma.ruleset.findUnique({ where: { id: ruleset.id } })
    expect(survivingRuleset).not.toBeNull()
    const systemUser = await prisma.user.findUnique({ where: { username: 'geloeschte-nutzer' } })
    expect(systemUser).not.toBeNull()
    expect(survivingRuleset!.createdById).toBe(systemUser!.id)

    // purely personal rows are cascade-deleted
    expect(await prisma.passkey.count({ where: { userId: owner.id } })).toBe(0)
    expect(await prisma.notification.count({ where: { userId: owner.id } })).toBe(0)
    expect(await prisma.friendship.count({ where: { OR: [{ requesterId: owner.id }, { addresseeId: owner.id }] } })).toBe(0)
    expect(await prisma.collectionItem.count({ where: { userId: owner.id } })).toBe(0)
    expect(await prisma.deck.count({ where: { id: deck.id } })).toBe(0)
    expect(await prisma.deckBuild.count({ where: { deckId: deck.id } })).toBe(0)

    // other users' legitimate data survives, severed from the personal link (Art. 17(3))
    const survivingMatch = await prisma.match.findUnique({ where: { id: match.id } })
    expect(survivingMatch).not.toBeNull()
    expect(survivingMatch!.player1Id).toBe(owner.id) // points at the now-anonymized row
    expect(survivingMatch!.scorePlayer1).toBe(4)
    const survivingBuild = await prisma.build.findUnique({ where: { id: build.id } })
    expect(survivingBuild).not.toBeNull() // shared Build rows are never deleted
    const survivingParticipant = await prisma.tournamentParticipant.findFirst({ where: { tournamentId: tournament.id, userId: owner.id } })
    expect(survivingParticipant).not.toBeNull()
    expect(survivingParticipant!.checkedIn).toBe(true)

    await cleanup(ids)
  })

  it('accepts a valid current TOTP token as the re-confirmation instead of the password', async () => {
    const suffix = Date.now().toString(36)
    const secret = authenticator.generateSecret()
    const user = await prisma.user.create({
      data: {
        username: `deltotp_${suffix}`,
        passwordHash: await bcrypt.hash('correct horse battery staple', 12),
        totpSecret: encryptSecret(secret),
        email: 'totp@example.de',
      },
    })
    const ids: Ids = {
      users: [user.id], clubs: [], rulesets: [], tournaments: [], decks: [], builds: [],
      matches: [], participants: [], friendships: [], collectionItems: [], notifications: [], passkeys: [],
    }
    mockAuth.mockResolvedValue(asSession({ id: user.id, name: user.username }))

    const res = await DELETE(new Request('http://localhost/api/account', {
      method: 'DELETE',
      body: JSON.stringify({ totpToken: authenticator.generate(secret) }),
    }))
    expect(res.status).toBe(200)
    const anonymized = await prisma.user.findUnique({ where: { id: user.id } })
    expect(anonymized!.email).toBeNull()
    expect(anonymized!.totpSecret).toBeNull()

    await cleanup(ids)
  })

  it('eraseOrAnonymizeUser is callable directly (the export of lib/accountErasure.ts)', async () => {
    const suffix = Date.now().toString(36)
    const user = await prisma.user.create({
      data: { username: `dellib_${suffix}`, passwordHash: 'x', email: 'lib@example.de' },
    })
    const ids: Ids = {
      users: [user.id], clubs: [], rulesets: [], tournaments: [], decks: [], builds: [],
      matches: [], participants: [], friendships: [], collectionItems: [], notifications: [], passkeys: [],
    }

    await eraseOrAnonymizeUser(user.id)

    const anonymized = await prisma.user.findUnique({ where: { id: user.id } })
    expect(anonymized!.email).toBeNull()
    expect(anonymized!.username).toBe(`geloescht_${user.id.slice(0, 8)}`)

    await cleanup(ids)
  })
})
