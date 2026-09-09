// lib/friendship.ts (Phase 4)
// The batch friendship gate. Every list surface that needs friendship status for MULTIPLE
// users (search results, club rosters, friend suggestions) must call areFriends once — never
// a per-user Friendship.findFirst loop [REVIEW-FIX: backend-security #13; performance P1].
//
// Semantics (fixed in Phase 1 Task 7): isFriend === true ONLY for Friendship.status ===
// 'ACCEPTED', regardless of who was requester. PENDING and BLOCKED rows never count.
import { prisma } from '@/lib/db'

// One findMany with an OR over both directions for every subject — a single query no matter
// how many subjectIds are passed (an empty list short-circuits to an empty Set, still zero
// queries, so callers don't need to special-case empty pages).
export async function areFriends(viewerId: string, subjectIds: string[]): Promise<Set<string>> {
  const uniqueIds = [...new Set(subjectIds)].filter((id) => id !== viewerId)
  if (uniqueIds.length === 0) return new Set()

  const rows = await prisma.friendship.findMany({
    where: {
      status: 'ACCEPTED',
      OR: uniqueIds.flatMap((id) => [
        { requesterId: viewerId, addresseeId: id },
        { requesterId: id, addresseeId: viewerId },
      ]),
    },
    select: { requesterId: true, addresseeId: true },
  })

  const friends = new Set<string>()
  for (const row of rows) {
    friends.add(row.requesterId === viewerId ? row.addresseeId : row.requesterId)
  }
  return friends
}

// Convenience wrapper for single-subject call sites (e.g. the profile page's privacy gate):
// still routes through the batch helper so there is exactly one friendship code path.
export async function isFriendWith(viewerId: string, subjectId: string): Promise<boolean> {
  if (viewerId === subjectId) return false
  return (await areFriends(viewerId, [subjectId])).has(subjectId)
}

// The full row between two users in either direction (any status) — what the friend-request
// UI and the friend API routes need to decide which action to offer / whether a new request
// is a duplicate. One query, both directions.
export async function friendshipBetween(
  aId: string,
  bId: string,
): Promise<{ id: string; status: 'PENDING' | 'ACCEPTED' | 'BLOCKED'; requesterId: string } | null> {
  if (aId === bId) return null
  const row = await prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId: aId, addresseeId: bId },
        { requesterId: bId, addresseeId: aId },
      ],
    },
    select: { id: true, status: true, requesterId: true },
  })
  return row
}
