// tests/e2e/judge-offline.spec.ts
// Phase 5 Part C — the authoritative offline proof ([REVIEW-FIX: frontend-pwa C1/C2/I4, plan
// acceptance criterion "airplane mode"): a judge scores while fully offline
// (context.setOffline(true)), the score lands in Postgres EXACTLY ONCE after reconnecting
// (not zero, not two), and a page RELOAD WHILE STILL OFFLINE still shows the match data —
// hydrated from the IndexedDB snapshot (page-side) on the SW-cached document (cache-first).
//
// Requirements to run: DATABASE_URL (Postgres) and REDIS_URL reachable — the Playwright
// webServer starts `npm run dev` and this spec seeds its own fixture rows via Prisma, so it
// runs on any dev machine with infra up AND in CI; it cannot run with no database at all.
// (iOS Safari manual checklist per [REVIEW-FIX: frontend-pwa N5] stays a documented manual test:
// installed PWA, airplane mode, flush on reopen.)
import { test, expect, type Page } from '@playwright/test'
import bcrypt from 'bcryptjs'
import { prisma } from '../../lib/db'

const suffix = Date.now().toString(36)
const PASSWORD = 'judgepw123'
let ids: {
  organizerId: string
  judgeId: string
  p1Id: string
  p2Id: string
  p1Name: string
  rulesetId: string
  tournamentId: string
  matchId: string
} | null = null

async function loginAsJudge(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Benutzername').fill(`e2e_jdg_${suffix}`)
  await page.getByLabel('Passwort').fill(PASSWORD)
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
}

test.beforeAll(async () => {
  const passwordHash = await bcrypt.hash(PASSWORD, 10)
  const organizer = await prisma.user.create({
    data: { username: `e2e_org_${suffix}`, passwordHash, role: 'ORGANIZER' },
  })
  const judge = await prisma.user.create({
    data: { username: `e2e_jdg_${suffix}`, passwordHash, role: 'JUDGE' },
  })
  const p1 = await prisma.user.create({ data: { username: `e2e_p1_${suffix}`, passwordHash } })
  const p2 = await prisma.user.create({ data: { username: `e2e_p2_${suffix}`, passwordHash } })
  const ruleset = await prisma.ruleset.create({
    data: { title: `E2E ${suffix}`, slug: `e2e-${suffix}`, createdById: organizer.id, targetPoints: 4 },
  })
  const tournament = await prisma.tournament.create({
    data: {
      title: `E2E Judge ${suffix}`,
      description: '',
      startDate: new Date(Date.now() + 86400_000),
      locationName: 'Bey-Arena',
      postalCode: '10115',
      city: 'Berlin',
      state: 'Berlin',
      latitude: 52.52,
      longitude: 13.405,
      rulesetId: ruleset.id,
      createdById: organizer.id,
    },
  })
  for (const userId of [p1.id, p2.id]) {
    await prisma.tournamentParticipant.create({ data: { tournamentId: tournament.id, userId, checkedIn: true } })
  }
  // Phase 5 Part C2: every Match requires a stage.
  const stage = await prisma.tournamentStage.create({
    data: { tournamentId: tournament.id, order: 1, name: 'Hauptbracket', format: 'SINGLE_ELIMINATION' },
  })
  const match = await prisma.match.create({
    data: {
      tournamentId: tournament.id,
      stageId: stage.id,
      judgeId: judge.id,
      player1Id: p1.id,
      player2Id: p2.id,
      round: 1,
      bracketOrder: 0,
      status: 'IN_PROGRESS',
    },
  })
  ids = {
    organizerId: organizer.id,
    judgeId: judge.id,
    p1Id: p1.id,
    p2Id: p2.id,
    p1Name: p1.username,
    rulesetId: ruleset.id,
    tournamentId: tournament.id,
    matchId: match.id,
  }
})

test.afterAll(async () => {
  if (!ids) return
  await prisma.match.deleteMany({ where: { tournamentId: ids.tournamentId } })
  await prisma.tournamentStage.deleteMany({ where: { tournamentId: ids.tournamentId } })
  await prisma.tournamentParticipant.deleteMany({ where: { tournamentId: ids.tournamentId } })
  await prisma.tournament.delete({ where: { id: ids.tournamentId } })
  await prisma.ruleset.delete({ where: { id: ids.rulesetId } })
  await prisma.user.deleteMany({
    where: { id: { in: [ids.organizerId, ids.judgeId, ids.p1Id, ids.p2Id] } },
  })
  // Browser-side IndexedDB queue/snapshot rows die with the test browser profile — nothing
  // server-side remains.
  await prisma.$disconnect()
})

test('judge scores offline; score syncs exactly once on reconnect; offline reload shows match data', async ({ page, context }) => {
  test.skip(!ids, 'fixture seeding failed')
  const judgeUrl = `/tournaments/${ids!.tournamentId}/judge?match=${ids!.matchId}`

  await loginAsJudge(page)
  await page.goto(judgeUrl)

  // The score pad renders with the live match (players resolved from the server render).
  await expect(page.getByLabel('Wertung')).toBeVisible()
  await expect(page.getByText(ids!.p1Name, { exact: true })).toBeVisible()

  // Prime the SW cache + IndexedDB snapshot with an online load, then go fully offline.
  await context.setOffline(true)

  // Score a Spin for player 1 while offline — the pad updates locally and queues the write.
  //
  // THE CLICK IS RETRIED AS A UNIT WITH ITS OBSERVABLE EFFECT, for two reasons:
  // 1. Hydration race: everything checked so far (Wertung/name visible) is satisfied by the
  //    SERVER-RENDERED markup, but the button's onClick only exists after React hydrates — and
  //    in dev, Turbopack compiles the judge route's client chunks lazily, so on a cold CI
  //    runner hydration can lag the SSR paint by seconds. Playwright's click actionability
  //    checks (visible/stable/enabled) all pass on the unhydrated button, so a single click
  //    can land on dead markup and silently do nothing (observed in CI: score stayed 0:0,
  //    badge stayed "Sync OK"). Retrying click+assert means a pre-hydration click just re-tries.
  // 2. The score assertion must NOT be a bare '1': the seeded usernames are 'e2e_p1_…', which
  //    contain the digit 1 and render inside the Spielstand section — toContainText('1') passes
  //    against an unchanged 0:0 pad and proves nothing. The sr-only live region's full text
  //    "Spielstand 1 zu 0" cannot false-match.
  // A landed click always leaves the score at exactly 1:0 (the assert runs immediately after
  // the click and toPass stops the loop on success), so the retry can never double-count.
  const spinP1 = page.getByRole('button', { name: `Spin für ${ids!.p1Name}` })
  await expect(async () => {
    await spinP1.click()
    await expect(page.getByLabel('Spielstand')).toContainText('Spielstand 1 zu 0', { timeout: 3_000 })
  }).toPass({ timeout: 60_000 })
  await expect(page.getByText(/warten auf Sync/)).toBeVisible()

  // RELOAD WHILE STILL OFFLINE: the SW serves the cached document; the pad hydrates the
  // score from the IndexedDB snapshot instead of rendering blank ([REVIEW-FIX: frontend-pwa I4]).
  await page.reload()
  await expect(page.getByLabel('Wertung')).toBeVisible()
  await expect(page.getByText(/warten auf Sync/)).toBeVisible()
  await expect
    .poll(async () => page.getByLabel('Spielstand').textContent())
    .toContain('Spielstand 1 zu 0')

  // Reconnect: the `online` trigger flushes the queue; the score lands in Postgres EXACTLY ONCE.
  await context.setOffline(false)
  await expect
    .poll(
      async () => {
        const row = await prisma.match.findUnique({ where: { id: ids!.matchId } })
        return row?.scorePlayer1 ?? -1
      },
      { timeout: 15_000 }
    )
    .toBe(1)
  const finalRow = await prisma.match.findUnique({ where: { id: ids!.matchId } })
  expect(finalRow!.scorePlayer2).toBe(0)
  expect(finalRow!.clientEventId).not.toBeNull()

  // The pending-sync indicator clears after the flush.
  await expect(page.getByText('Sync OK')).toBeVisible()
})
