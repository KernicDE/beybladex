// tests/integration/user-search.test.ts
// Phase 4: GET /api/search/users and the shared lib/userSearch query, against real Postgres
// (CI-only, never run locally per Global Constraints' no-local-Docker rule).
//
// Discoverability rules under test (documented in lib/userSearch.ts):
//   - username prefix match, case-insensitive, paginated (take + id cursor)
//   - PRIVATE profile ⇒ invisible to anonymous searchers and non-friends, visible to friends
//   - FRIENDS_ONLY profile ⇒ still findable by username, card projected through
//     resolveVisibleFields (minimal info for non-friends)
//   - the friendship check for a whole candidate page goes through lib/friendship.ts's
//     batch helper (one Friendship query per batch, never one per candidate)
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest'
import { GET } from '@/app/api/search/users/route'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'
import { searchUsers } from '@/lib/userSearch'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

describe('GET /api/search/users (visibility-aware, paginated)', () => {
  const suffix = Date.now().toString(36)
  const prefix = `sus_${suffix}`
  const names = {
    public: `${prefix}pub`, private: `${prefix}pri`, friendsOnly: `${prefix}fro`,
    searcher: `${prefix}sea`, paged0: `${prefix}pg0`, paged1: `${prefix}pg1`, paged2: `${prefix}pg2`,
  }
  const ids: Record<string, string> = {}

  beforeAll(async () => {
    const mk = (username: string, extra: Record<string, unknown> = {}) =>
      prisma.user.create({ data: { username, passwordHash: 'x', isMinor: false, ...extra } })

    const users = await Promise.all([
      mk(names.public, { city: 'Hamburg', locationVisibility: 'PUBLIC' }),
      mk(names.private, { profileVisibility: 'PRIVATE' }),
      mk(names.friendsOnly, { profileVisibility: 'FRIENDS_ONLY', city: 'Köln' }),
      mk(names.searcher),
      mk(names.paged0), mk(names.paged1), mk(names.paged2),
    ])
    for (let i = 0; i < users.length; i++) ids[Object.values(names)[i]] = users[i].id

    // searcher is FRIENDS with the PRIVATE user — they must be able to find each other
    await prisma.friendship.create({
      data: { requesterId: users[3].id, addresseeId: users[1].id, status: 'ACCEPTED' },
    })
  })

  afterAll(async () => {
    await prisma.friendship.deleteMany({ where: { requesterId: ids[names.searcher] } })
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } })
  })

  beforeEach(() => {
    mockAuth.mockResolvedValue(asSession(null))
  })

  afterEach(() => {
    mockAuth.mockReset()
  })

  it('empty q returns an empty result', async () => {
    const res = await GET(new Request('http://localhost/api/search/users?q='))
    expect(res.status).toBe(200)
    expect((await res.json()).users).toHaveLength(0)
  })

  it('anonymous searchers see only PUBLIC profiles', async () => {
    const res = await GET(new Request(`http://localhost/api/search/users?q=${prefix}`))
    expect(res.status).toBe(200)
    const body = await res.json()
    const found = body.users.map((u: { username: string }) => u.username)
    expect(found).toContain(names.public)
    expect(found).toContain(names.friendsOnly) // findable by username, minimal card
    expect(found).not.toContain(names.private) // PRIVATE ⇒ not discoverable
  })

  it('a logged-in non-friend also cannot find the PRIVATE profile', async () => {
    mockAuth.mockResolvedValue(asSession({ id: ids[names.paged0], name: names.paged0 }))
    const res = await GET(new Request(`http://localhost/api/search/users?q=${names.private}`))
    expect(res.status).toBe(200)
    expect((await res.json()).users).toHaveLength(0)
  })

  it('a FRIEND of a PRIVATE profile CAN find them (private ⇒ hidden only from non-friends)', async () => {
    mockAuth.mockResolvedValue(asSession({ id: ids[names.searcher], name: names.searcher }))
    const res = await GET(new Request(`http://localhost/api/search/users?q=${names.private}`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.users.map((u: { username: string }) => u.username)).toContain(names.private)
  })

  it('case-insensitive prefix match', async () => {
    const res = await GET(new Request(`http://localhost/api/search/users?q=${prefix.toUpperCase().slice(0, 8)}`))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.users.length).toBeGreaterThan(0)
  })

  it('paginates with take + cursor, no duplicates across pages', async () => {
    mockAuth.mockResolvedValue(asSession({ id: ids[names.searcher], name: names.searcher }))
    const page1 = await (await GET(new Request(`http://localhost/api/search/users?q=${prefix}&take=3`))).json()
    expect(page1.users).toHaveLength(3)
    expect(page1.nextCursor).toBeTruthy()

    const page2 = await (await GET(new Request(`http://localhost/api/search/users?q=${prefix}&take=3&cursor=${page1.nextCursor}`))).json()
    const usernames = [...page1.users, ...page2.users].map((u: { username: string }) => u.username)
    expect(new Set(usernames).size).toBe(usernames.length)
    // usernames are ordered, so page2 strictly follows page1
    expect(usernames).toEqual([...usernames].sort())
  })

  it('the friends-only card carries minimal info for non-friends (no city leaks)', async () => {
    mockAuth.mockResolvedValue(asSession({ id: ids[names.paged0], name: names.paged0 }))
    const res = await GET(new Request(`http://localhost/api/search/users?q=${names.friendsOnly}`))
    const body = await res.json()
    const card = body.users.find((u: { username: string }) => u.username === names.friendsOnly)
    expect(card).toBeDefined()
    expect(card.city).toBeNull() // location is not visible to a non-friend
    expect(card.isFriend).toBe(false)
  })
})

describe('searchUsers batch-friendship invariant', () => {
  const suffix = `${Date.now().toString(36)}b`
  const prefix = `sub_${suffix}`
  let viewerId: string

  beforeAll(async () => {
    const viewer = await prisma.user.create({ data: { username: `${prefix}v`, passwordHash: 'x', isMinor: false } })
    viewerId = viewer.id
    // 25 candidates sharing the prefix — one page worth of friendship checks
    await prisma.user.createMany({
      data: Array.from({ length: 25 }, (_, i) => ({
        username: `${prefix}c${String(i).padStart(2, '0')}`, passwordHash: 'x', isMinor: false,
      })),
    })
  })

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: prefix } } })
  })

  it('computes friendship for a 25-candidate page with ONE Friendship query', async () => {
    // Proof method: spy on the friendship delegate's findMany for the duration of one
    // searchUsers call — the standing "one query, not N" assertion at the integration level
    // (Prisma 6 removed $use middleware, so a vi.spyOn on the delegate replaces it).
    const spy = vi.spyOn(prisma.friendship, 'findMany')
    try {
      const result = await searchUsers({ viewerId, q: prefix, take: 20 })
      expect(result.users.length).toBeGreaterThan(0)
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      spy.mockRestore()
    }
  })
})
