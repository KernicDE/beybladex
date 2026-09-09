// tests/unit/friendship-batch.test.ts
// Phase 4: lib/friendship.ts's areFriends must issue EXACTLY ONE Friendship query no matter
// how many subject ids it checks — the standing rule for every list surface that computes
// friendship for multiple users at once ([REVIEW-FIX: backend-security #13; performance P1];
// master plan: "a 30-member roster triggers exactly one Friendship query, not thirty").
//
// How "one query" is asserted: @/lib/db is mocked, so prisma.friendship.findMany is a spy —
// we assert it was called exactly once for N subjects, and that the single call's `where`
// carries status: 'ACCEPTED' plus an OR over BOTH directions for every subject (the
// directional @@unique([requesterId, addresseeId]) means friendship can be stored either way,
// so each subject contributes two OR branches). The empty-input case must issue ZERO queries
// (callers paging over empty lists must not pay a round trip).
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/db', () => ({
  prisma: { friendship: { findMany: vi.fn(), findFirst: vi.fn() } },
}))

import { prisma } from '@/lib/db'
import { areFriends, isFriendWith, friendshipBetween } from '@/lib/friendship'

const findMany = vi.mocked(prisma.friendship.findMany)
const findFirst = vi.mocked(prisma.friendship.findFirst)

describe('areFriends (batch helper)', () => {
  beforeEach(() => {
    findMany.mockReset()
  })

  it('issues exactly one findMany for N subject ids (N = 30)', async () => {
    const viewerId = 'viewer'
    const subjectIds = Array.from({ length: 30 }, (_, i) => `user-${i}`)
    // viewer is friends with user-3 (stored requester→addressee) and user-7 (stored
    // addressee→requester, i.e. the reverse direction — both must be found).
    findMany.mockResolvedValue([
      { requesterId: viewerId, addresseeId: 'user-3' },
      { requesterId: 'user-7', addresseeId: viewerId },
    ] as never)

    const friends = await areFriends(viewerId, subjectIds)

    expect(findMany).toHaveBeenCalledTimes(1)
    const arg = findMany.mock.calls[0][0] as { where: { status: string; OR: unknown[] } }
    expect(arg.where.status).toBe('ACCEPTED')
    // 30 subjects × both directions = 60 OR branches in the ONE query
    expect(arg.where.OR).toHaveLength(60)
    expect([...friends].sort()).toEqual(['user-3', 'user-7'])
  })

  it('issues zero queries for an empty subject list', async () => {
    const friends = await areFriends('viewer', [])
    expect(findMany).not.toHaveBeenCalled()
    expect(friends.size).toBe(0)
  })

  it('drops duplicate subject ids and the viewer themself from the query', async () => {
    findMany.mockResolvedValue([] as never)
    await areFriends('viewer', ['a', 'a', 'viewer', 'b'])
    expect(findMany).toHaveBeenCalledTimes(1)
    const arg = findMany.mock.calls[0][0] as { where: { OR: { addresseeId: string }[] } }
    expect(arg.where.OR).toHaveLength(4) // a and b, both directions
  })
})

describe('isFriendWith (single-pair wrapper)', () => {
  beforeEach(() => {
    findMany.mockReset()
  })

  it('routes through the batch helper (one query) and checks the returned set', async () => {
    findMany.mockResolvedValue([{ requesterId: 'subject', addresseeId: 'viewer' }] as never)
    expect(await isFriendWith('viewer', 'subject')).toBe(true)
    expect(findMany).toHaveBeenCalledTimes(1)

    findMany.mockResolvedValue([] as never)
    expect(await isFriendWith('viewer', 'subject')).toBe(false)
  })

  it('short-circuits self without querying', async () => {
    expect(await isFriendWith('viewer', 'viewer')).toBe(false)
    expect(findMany).not.toHaveBeenCalled()
  })
})

describe('friendshipBetween (row lookup for the request UI/routes)', () => {
  beforeEach(() => {
    findFirst.mockReset()
  })

  it('checks both directions in one query', async () => {
    findFirst.mockResolvedValue({ id: 'f1', status: 'PENDING', requesterId: 'a' } as never)

    const row = await friendshipBetween('a', 'b')
    expect(row).toEqual({ id: 'f1', status: 'PENDING', requesterId: 'a' })
    expect(findFirst).toHaveBeenCalledTimes(1)
    const arg = findFirst.mock.calls[0][0] as { where: { OR: unknown[] } }
    expect(arg.where.OR).toHaveLength(2)
  })
})
