// scripts/seedTestEnvironment.ts
// One-off demo/test-environment data generator (run manually against a Test-stack DB — never
// against production). Assumes the real catalog (Part/Beyblade/MediaAsset) has ALREADY been
// copied in separately (see the ops runbook in AGENTS.md's Test-Environment section) — this
// script only adds community/competition data on top of it: 500 users, ~15 clubs, ~40 teams,
// two seasons, and 50 tournaments with real, simulated match history (reusing the actual
// bracket/Swiss propagation + Elo + placement logic, not a hand-rolled approximation, so the
// resulting Rangliste/placement/Team-Elo data is exactly as internally consistent as if these
// tournaments had really been played).
//
// Run: DATABASE_URL=postgresql://...@localhost:15433/beybladex_test_db npx tsx scripts/seedTestEnvironment.ts
//
// Deliberately NOT seeded (kept out of scope): personal Decks/Builds/Collection/Purchases,
// Ratings/reviews, notifications, push subscriptions, team-mode tournaments (TeamMatch
// encounter generation needs a separate sub-game creation step this script doesn't drive) —
// Teams exist with real rosters but no played encounters, so the Teams ranking tab legitimately
// shows the "no ranked teams yet" empty state in this seed. Idempotency: NOT idempotent —
// running this twice against the same database creates a second batch of 500 users etc. Only
// ever run it against a freshly-migrated, otherwise-empty (besides the catalog) database.
import { PrismaClient, type Match } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { generateSingleEliminationBracket, nextSingleEliminationSlot } from '../lib/bracket'
import { recordSwissResult } from '../lib/stageFlow'
import { applyMatchResultToRatings } from '../lib/season'
import { slugify, uniqueSlug } from '../lib/slug'
import { validateTeamName } from '../lib/teams'

const prisma = new PrismaClient()

// ─── tunables (env-overridable for a fast smoke run before the full 500/50 seed) ──────────
const USER_COUNT = Number(process.env.SEED_USER_COUNT ?? 500)
const CLUB_COUNT = Number(process.env.SEED_CLUB_COUNT ?? 15)
const TEAM_COUNT = Number(process.env.SEED_TEAM_COUNT ?? 40)
const TOURNAMENT_COUNT = Number(process.env.SEED_TOURNAMENT_COUNT ?? 50)
const DEMO_PASSWORD = 'TestEnv2026!'

// ─── name pools ──────────────────────────────────────────────────────────────────────────
const FIRST_NAMES = [
  'Lukas', 'Jonas', 'Finn', 'Elias', 'Noah', 'Leon', 'Paul', 'Felix', 'Anton', 'Ben',
  'Emil', 'Moritz', 'Julian', 'Tim', 'David', 'Simon', 'Niklas', 'Fabian', 'Jan', 'Erik',
  'Emma', 'Mia', 'Hannah', 'Lena', 'Lea', 'Sofia', 'Marie', 'Laura', 'Anna', 'Clara',
  'Ida', 'Nina', 'Lisa', 'Julia', 'Sarah', 'Elin', 'Frieda', 'Mila', 'Ella', 'Zoe',
  'Matteo', 'Luca', 'Milan', 'Theo', 'Oskar', 'Aaron', 'Samuel', 'Vincent', 'Konstantin', 'Bruno',
  'Mira', 'Nora', 'Amelie', 'Charlotte', 'Greta', 'Pia', 'Wanda', 'Leni', 'Romy', 'Stella',
]
const LAST_NAMES = [
  'Müller', 'Schmidt', 'Schneider', 'Fischer', 'Weber', 'Meyer', 'Wagner', 'Becker', 'Schulz', 'Hoffmann',
  'Koch', 'Richter', 'Klein', 'Wolf', 'Schröder', 'Neumann', 'Schwarz', 'Zimmermann', 'Braun', 'Krüger',
  'Hofer', 'Gruber', 'Berger', 'Moser', 'Huber', 'Bauer', 'Pichler', 'Steiner', 'Egger', 'Mayr',
  'Meier', 'Keller', 'Weiss', 'Baumann', 'Frei', 'Zimmermann', 'Vogel', 'Sutter', 'Gerber', 'Brunner',
  'Novak', 'Kowalski', 'Rossi', 'Dubois', 'Andersen', 'Larsen', 'Silva', 'Costa', 'Petrov', 'Ivanov',
]
const CLUB_NAME_POOL = [
  'Blade Dragons', 'Stormbreakers', 'Iron Vortex', 'Nordlicht Blader', 'Rheinblitz', 'Alpen Arena Crew',
  'Phoenix Spinners', 'Wirbelwind', 'Shadow Fang Club', 'Blitzscheibe', 'Bavaria Blader', 'Arena Wolves',
  'Spin Masters DACH', 'Tornado Crew', 'Blade Legion',
]

let rngState = 42
function rng(): number {
  // Deterministic xorshift so re-runs (for debugging) are reproducible, not truly random.
  rngState ^= rngState << 13
  rngState ^= rngState >>> 17
  rngState ^= rngState << 5
  rngState |= 0
  return ((rngState % 1000000) + 1000000) % 1000000 / 1000000
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)]!
}
function shuffle<T>(arr: T[]): T[] {
  const copy = [...arr]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j]!, copy[i]!]
  }
  return copy
}
function randomInt(min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

const CITIES = [
  { city: 'Berlin', state: 'Berlin', country: 'DE' as const, lat: 52.52, lon: 13.405 },
  { city: 'München', state: 'Bayern', country: 'DE' as const, lat: 48.1351, lon: 11.582 },
  { city: 'Hamburg', state: 'Hamburg', country: 'DE' as const, lat: 53.5511, lon: 9.9937 },
  { city: 'Köln', state: 'Nordrhein-Westfalen', country: 'DE' as const, lat: 50.9375, lon: 6.9603 },
  { city: 'Frankfurt am Main', state: 'Hessen', country: 'DE' as const, lat: 50.1109, lon: 8.6821 },
  { city: 'Stuttgart', state: 'Baden-Württemberg', country: 'DE' as const, lat: 48.7758, lon: 9.1829 },
  { city: 'Leipzig', state: 'Sachsen', country: 'DE' as const, lat: 51.3397, lon: 12.3731 },
  { city: 'Wien', state: 'Wien', country: 'AT' as const, lat: 48.2082, lon: 16.3738 },
  { city: 'Graz', state: 'Steiermark', country: 'AT' as const, lat: 47.0707, lon: 15.4395 },
  { city: 'Zürich', state: 'Zürich', country: 'CH' as const, lat: 47.3769, lon: 8.5417 },
  { city: 'Bern', state: 'Bern', country: 'CH' as const, lat: 46.948, lon: 7.4474 },
]

async function main() {
  console.log('Catalog check…')
  const [partCount, beybladeCount] = await Promise.all([prisma.part.count(), prisma.beyblade.count()])
  if (partCount === 0 || beybladeCount === 0) {
    throw new Error('Catalog is empty — copy Part/Beyblade/MediaAsset from production first (see AGENTS.md Test-Environment runbook).')
  }
  console.log(`  catalog OK: ${partCount} parts, ${beybladeCount} beyblades`)

  // ─── users ───────────────────────────────────────────────────────────────────────────
  console.log(`Seeding ${USER_COUNT} users…`)
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12)
  const usedUsernames = new Set<string>()
  const userIds: string[] = []
  const userBatch: { username: string; displayName: string; passwordHash: string; country: 'DE' | 'AT' | 'CH'; role: 'USER' | 'TRUSTED' | 'ORGANIZER' | 'ADMIN'; id: string }[] = []

  // One known-credential admin account so the environment is actually explorable as staff.
  userBatch.push({ id: crypto.randomUUID(), username: 'testenv_admin', displayName: 'Test-Admin', passwordHash, country: 'DE', role: 'ADMIN' })
  usedUsernames.add('testenv_admin')

  for (let i = 0; i < USER_COUNT - 1; i++) {
    const first = pick(FIRST_NAMES)
    const last = pick(LAST_NAMES)
    const base = `${first.toLowerCase()}.${last.toLowerCase()}`.replace(/[^a-z.]/g, '')
    let username = base
    let n = 2
    while (usedUsernames.has(username)) {
      username = `${base}${n}`
      n++
    }
    usedUsernames.add(username)
    const role = i < 5 ? 'ORGANIZER' : i < 20 ? 'TRUSTED' : 'USER'
    userBatch.push({
      id: crypto.randomUUID(),
      username,
      displayName: `${first} ${last}`,
      passwordHash,
      country: pick(['DE', 'DE', 'DE', 'AT', 'CH'] as const),
      role,
    })
  }
  await prisma.user.createMany({ data: userBatch, skipDuplicates: true })
  userIds.push(...userBatch.map((u) => u.id))
  console.log(`  ${userIds.length} users created (login: testenv_admin / ${DEMO_PASSWORD}, shared password for all seeded users)`)

  // ─── clubs ───────────────────────────────────────────────────────────────────────────
  console.log(`Seeding ${CLUB_COUNT} clubs…`)
  const clubIds: string[] = []
  for (let i = 0; i < CLUB_COUNT; i++) {
    const name = CLUB_NAME_POOL[i] ?? `Club ${i + 1}`
    const slug = await uniqueSlug(slugify(name), async (s) => (await prisma.club.findUnique({ where: { slug: s }, select: { id: true } })) !== null)
    const ownerId = pick(userIds)
    const club = await prisma.club.create({
      data: { name, slug, ownerId, description: `Community-Club für ${name} — Teil der Test-Umgebung.` },
    })
    clubIds.push(club.id)
    const memberCount = randomInt(8, 35)
    const members = shuffle(userIds).slice(0, memberCount)
    await prisma.clubMember.createMany({
      data: members.map((userId, idx) => ({ clubId: club.id, userId, isAdmin: userId === ownerId || idx === 1, status: 'ACTIVE' as const })),
      skipDuplicates: true,
    })
  }
  console.log(`  ${clubIds.length} clubs created`)

  // ─── teams ───────────────────────────────────────────────────────────────────────────
  console.log(`Seeding ${TEAM_COUNT} teams…`)
  const teamIds: string[] = []
  const usedTeamMembers = new Set<string>() // a user may captain/join more than one team; only avoid dup WITHIN one team
  for (let i = 0; i < TEAM_COUNT; i++) {
    const roster = shuffle(userIds).slice(0, 3)
    const nameCheck = validateTeamName(`Team ${pick(LAST_NAMES)} ${i + 1}`)
    if (!nameCheck.ok) continue
    const slug = await uniqueSlug(slugify(nameCheck.name), async (s) => (await prisma.team.findUnique({ where: { slug: s }, select: { id: true } })) !== null)
    const team = await prisma.team.create({
      data: {
        name: nameCheck.name,
        slug,
        clubId: rng() < 0.4 ? pick(clubIds) : null,
        createdById: roster[0]!,
        members: { create: roster.map((userId, idx) => ({ userId, role: idx === 0 ? 'CAPTAIN' as const : 'MEMBER' as const })) },
      },
    })
    teamIds.push(team.id)
  }
  void usedTeamMembers
  console.log(`  ${teamIds.length} teams created`)

  // ─── ruleset ─────────────────────────────────────────────────────────────────────────
  const ruleset = await prisma.ruleset.create({
    data: { title: 'WBO Standard Rules (Test-Umgebung)', slug: 'wbo-standard-test', createdById: userIds[0]!, isPublic: true },
  })

  // ─── seasons ─────────────────────────────────────────────────────────────────────────
  const now = new Date()
  const seasonAStart = new Date(now.getTime() - 400 * 86400_000)
  const seasonAEnd = new Date(now.getTime() - 190 * 86400_000)
  const seasonBStart = seasonAEnd
  const seasonBEnd = new Date(now.getTime() + 60 * 86400_000)
  const seasonA = await prisma.season.create({ data: { name: 'Season 1 (Test)', startsAt: seasonAStart, endsAt: seasonAEnd, status: 'COMPLETED' } })
  const seasonB = await prisma.season.create({ data: { name: 'Season 2 (Test)', startsAt: seasonBStart, endsAt: seasonBEnd, status: 'ACTIVE' } })
  console.log(`Seasons: ${seasonA.name} (completed), ${seasonB.name} (active)`)

  // ─── tournaments ─────────────────────────────────────────────────────────────────────
  console.log(`Seeding ${TOURNAMENT_COUNT} tournaments…`)
  let simulated = 0
  for (let i = 0; i < TOURNAMENT_COUNT; i++) {
    const daysAgo = randomInt(-20, 380) // a handful land in the future (upcoming events)
    const startDate = new Date(now.getTime() - daysAgo * 86400_000)
    const loc = pick(CITIES)
    const isUpcoming = startDate.getTime() > now.getTime()
    const kind = rng() < 0.8 ? 'BRACKET' : pick(['STAMMTISCH', 'FREEPLAY'] as const)
    const creatorId = pick(userIds)
    const seasonForDate = startDate < seasonAEnd ? seasonA : seasonB

    const tournament = await prisma.tournament.create({
      data: {
        title: `${pick(['Frühjahrscup', 'Sommerturnier', 'Herbstpokal', 'Winter-Clash', 'Arena Open', 'Community Cup', 'Regional Masters'])} ${loc.city} ${startDate.getFullYear()}`,
        description: 'Automatisch erzeugtes Test-Turnier (Test-Umgebung).',
        startDate,
        locationName: `Arena ${loc.city}`,
        postalCode: '00000',
        city: loc.city,
        state: loc.state,
        country: loc.country,
        latitude: loc.lat,
        longitude: loc.lon,
        kind,
        createdById: creatorId,
        rulesetId: kind === 'BRACKET' ? ruleset.id : null,
        clubId: rng() < 0.3 ? pick(clubIds) : null,
      },
    })

    if (kind !== 'BRACKET' || isUpcoming) continue // calendar-only entry, nothing to simulate

    const size = pick([8, 8, 16, 16, 32])
    const participants = shuffle(userIds).slice(0, size)
    await prisma.tournamentParticipant.createMany({
      data: participants.map((userId) => ({ tournamentId: tournament.id, userId, checkedIn: true })),
    })

    const format = rng() < 0.6 ? 'SINGLE_ELIMINATION' : 'SWISS'
    const stage = await prisma.tournamentStage.create({
      data: {
        tournamentId: tournament.id,
        order: 1,
        name: 'Hauptrunde',
        format,
        swissRounds: format === 'SWISS' ? Math.ceil(Math.log2(size)) + 1 : null,
      },
    })

    try {
      if (format === 'SINGLE_ELIMINATION') {
        await simulateSingleElimination(tournament.id, stage.id, participants, seasonForDate.id)
      } else {
        await simulateSwiss(tournament.id, stage.id, participants, seasonForDate.id, stage.swissRounds!)
      }
      await prisma.tournamentStage.update({ where: { id: stage.id }, data: { status: 'COMPLETED' } })
      await prisma.tournament.update({ where: { id: tournament.id }, data: { completedAt: new Date(startDate.getTime() + 5 * 3600_000) } })
      await computeAndPersistPlacementInline(tournament.id)
      simulated++
    } catch (err) {
      console.error(`  tournament ${tournament.id} simulation failed:`, err)
    }
  }
  console.log(`  ${simulated} tournaments fully simulated (matches, standings, Elo, placement)`)

  console.log('Done.')
}

// Winner selection biased slightly by a stable per-user "skill" derived from their id, so Elo
// spreads out into a believable ladder instead of a pure coin-flip random walk.
const skillCache = new Map<string, number>()
function skillOf(userId: string): number {
  let s = skillCache.get(userId)
  if (s === undefined) {
    let h = 0
    for (const ch of userId) h = (h * 31 + ch.charCodeAt(0)) % 1000
    s = h / 1000
    skillCache.set(userId, s)
  }
  return s
}
function pickWinner(a: string, b: string): string {
  const pa = 0.5 + (skillOf(a) - skillOf(b)) * 0.3
  return rng() < pa ? a : b
}

async function completeMatch(match: Match, format: string, seasonId: string) {
  const player1Id = match.player1Id!
  const player2Id = match.player2Id!
  const winnerId = pickWinner(player1Id, player2Id)
  const loserId = winnerId === player1Id ? player2Id : player1Id
  const winnerScore = 3
  const loserScore = randomInt(0, 2)
  await prisma.match.update({
    where: { id: match.id },
    data: {
      status: 'COMPLETED',
      winnerId,
      scorePlayer1: winnerId === player1Id ? winnerScore : loserScore,
      scorePlayer2: winnerId === player2Id ? winnerScore : loserScore,
    },
  })
  if (format === 'SWISS') {
    await recordSwissResult(match.stageId, winnerId, loserId, prisma)
  } else {
    const target = nextSingleEliminationSlot(match)
    await prisma.match.updateMany({
      where: { stageId: match.stageId, round: target.round, bracketOrder: target.bracketOrder },
      data: { [target.slot]: winnerId },
    })
  }
  await applyMatchResultToRatings(prisma, seasonId, winnerId, loserId)
  return winnerId
}

async function simulateSingleElimination(tournamentId: string, stageId: string, participants: string[], seasonId: string) {
  const nodes = generateSingleEliminationBracket(participants.map((userId) => ({ userId })))
  await prisma.match.createMany({
    data: nodes.map((n) => ({ tournamentId, stageId, round: n.round, bracketOrder: n.bracketOrder, player1Id: n.player1Id, player2Id: n.player2Id, winnerId: n.winnerId, status: n.status })),
  })
  await prisma.stageStanding.createMany({ data: participants.map((userId) => ({ stageId, userId })) })
  // Round-1 byes advance immediately (mirrors lib/stageGenerate.ts's own bye-advancement loop).
  for (const bye of nodes.filter((n) => n.round === 1 && n.winnerId !== null)) {
    const slot = bye.bracketOrder % 2 === 0 ? 'player1Id' : 'player2Id'
    await prisma.match.updateMany({ where: { stageId, round: 2, bracketOrder: Math.floor(bye.bracketOrder / 2) }, data: { [slot]: bye.winnerId } })
  }

  const maxRound = Math.max(...nodes.map((n) => n.round))
  for (let round = 1; round <= maxRound; round++) {
    let pending = await prisma.match.findMany({ where: { stageId, round, status: { in: ['PENDING', 'IN_PROGRESS'] }, player1Id: { not: null }, player2Id: { not: null } } })
    // A round can gain newly-resolved matches from THIS round's own bye/slot writes above —
    // loop until nothing playable remains before moving to the next round.
    while (pending.length > 0) {
      for (const m of pending) {
        await completeMatch(m, 'SINGLE_ELIMINATION', seasonId)
      }
      pending = await prisma.match.findMany({ where: { stageId, round, status: { in: ['PENDING', 'IN_PROGRESS'] }, player1Id: { not: null }, player2Id: { not: null } } })
    }
  }
}

async function simulateSwiss(tournamentId: string, stageId: string, participants: string[], seasonId: string, swissRounds: number) {
  const { pairSwissRound, computeBuchholz } = await import('../lib/swiss')
  await prisma.stageStanding.createMany({ data: participants.map((userId) => ({ stageId, userId })) })

  for (let round = 1; round <= swissRounds; round++) {
    const standings = await prisma.stageStanding.findMany({ where: { stageId } })
    const bh = computeBuchholz(standings)
    for (const [userId, value] of bh) await prisma.stageStanding.updateMany({ where: { stageId, userId }, data: { buchholz: value } })
    const seeded = standings.map((s) => ({ ...s, buchholz: bh.get(s.userId) ?? 0, seed: null }))
    const { pairings } = pairSwissRound(seeded)

    for (const p of pairings) {
      if (p.player2Id === null) {
        await prisma.match.create({ data: { tournamentId, stageId, round: 0, swissRound: round, player1Id: p.player1Id, player2Id: null, winnerId: p.player1Id, status: 'COMPLETED' } })
        await prisma.stageStanding.updateMany({ where: { stageId, userId: p.player1Id }, data: { wins: { increment: 1 }, byes: { increment: 1 } } })
        continue
      }
      const match = await prisma.match.create({ data: { tournamentId, stageId, round: 0, swissRound: round, player1Id: p.player1Id, player2Id: p.player2Id, status: 'PENDING' } })
      await completeMatch(match, 'SWISS', seasonId)
    }
  }
}

/** Minimal inline copy of lib/tournamentPlacement.ts's single-stage case — this seed never
 *  creates multi-stage tournaments, so the full stage-chaining logic isn't needed here; kept
 *  separate rather than importing the lib version to avoid pulling in its multi-stage
 *  qualifiedUserIds traversal for a script that never populates that field. */
async function computeAndPersistPlacementInline(tournamentId: string) {
  const { sortSwiss } = await import('../lib/swiss')
  const { eliminationRanking } = await import('../lib/bracket')
  const stage = await prisma.tournamentStage.findFirst({ where: { tournamentId }, select: { id: true, format: true } })
  if (!stage) return
  const participants = await prisma.tournamentParticipant.findMany({ where: { tournamentId, withdrawn: false }, select: { userId: true } })
  const pool = participants.map((p) => p.userId)
  let ranking: string[]
  if (stage.format === 'SWISS' || stage.format === 'ROUND_ROBIN') {
    const standings = await prisma.stageStanding.findMany({ where: { stageId: stage.id } })
    ranking = sortSwiss(standings).map((s) => s.userId)
  } else {
    const matches = await prisma.match.findMany({ where: { stageId: stage.id } })
    ranking = eliminationRanking(matches, pool)
  }
  await prisma.$transaction(ranking.map((userId, idx) => prisma.tournamentParticipant.update({ where: { tournamentId_userId: { tournamentId, userId } }, data: { placement: idx + 1 } })))
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
