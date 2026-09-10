// lib/userSearch.ts (Phase 4)
// Shared user-search query behind GET /api/search/users AND the /search page's Nutzer
// section, so both surfaces enforce identical visibility semantics.
//
// Discoverability decision (documented, per phase planning): a PRIVATE-profile user does not
// appear in search results AT ALL for non-friends (and anonymous searchers) — search is
// discovery, and PRIVATE means "not discoverable". A FRIENDS_ONLY-profile user REMAINS
// findable by username prefix (they are still a platform identity and can be located by
// people who know their name — that's how a friend request gets started), but their card
// carries only username + display name; no location/bio details are attached. Minor ceilings
// from resolveVisibleFields apply to the card fields the same way they do on the profile.
// Anonymous searchers see only PUBLIC profiles.
//
// Pagination: take + id cursor (standing rule). Because visibility filtering happens after
// the fetch (friendship requires a per-candidate check via the batch helper), the scanner
// reads up to MAX_SCAN_BATCHES candidate pages per request until `take` visible results
// accumulate — bounded cost, never a silent full-table scan.
import { prisma } from '@/lib/db'
import { areFriends } from '@/lib/friendship'
import { resolveVisibleFields } from '@/lib/privacy'

const PAGE_SIZE = 20
const MAX_SCAN_BATCHES = 5

export interface UserSearchResult {
  id: string
  username: string
  displayName: string | null
  city: string | null
  isFriend: boolean
}

export async function searchUsers(opts: {
  viewerId: string | null
  q: string
  take?: number
  cursor?: string | null
}): Promise<{ users: UserSearchResult[]; nextCursor: string | null }> {
  const take = Math.min(Math.max(opts.take ?? PAGE_SIZE, 1), 50)
  const q = opts.q.trim()
  if (q.length === 0) return { users: [], nextCursor: null }

  const visible: UserSearchResult[] = []
  let cursor = opts.cursor ?? null
  let exhausted = false

  for (let batch = 0; batch < MAX_SCAN_BATCHES && !exhausted && visible.length < take; batch++) {
    const candidates = await prisma.user.findMany({
      where: { username: { startsWith: q, mode: 'insensitive' } },
      orderBy: [{ username: 'asc' }, { id: 'asc' }],
      take: take + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true, username: true, displayName: true, city: true, bio: true, discordTag: true,
        birthDate: true, isMinor: true, avatarImageId: true, profileVisibility: true, locationVisibility: true,
        collectionVisibility: true, decksVisibility: true, ageVisibility: true,
      },
    })
    exhausted = candidates.length <= take
    const scanned = exhausted ? candidates : candidates.slice(0, take)
    cursor = scanned.length > 0 ? scanned[scanned.length - 1].id : cursor

    // Batch friendship check for the whole candidate page — ONE Friendship query per batch,
    // never one per candidate (standing lib/friendship.ts rule). Anonymous searchers have no
    // friends by definition, so the query is skipped entirely for them.
    const friendIds = opts.viewerId
      ? await areFriends(opts.viewerId, scanned.map((c) => c.id))
      : new Set<string>()

    for (const candidate of scanned) {
      const isOwner = opts.viewerId === candidate.id
      const isFriend = friendIds.has(candidate.id)
      // PRIVATE ⇒ hidden unless owner or friend. FRIENDS_ONLY ⇒ findable, but the card is
      // projected through resolveVisibleFields, so only PUBLIC-level fields survive anyway.
      if (candidate.profileVisibility === 'PRIVATE' && !isOwner && !isFriend) continue
      const view = resolveVisibleFields(candidate, opts.viewerId, isFriend)
      visible.push({
        id: candidate.id,
        username: view.username,
        displayName: view.displayName,
        city: view.city,
        isFriend,
      })
    }
  }

  const page = visible.slice(0, take)
  return { users: page, nextCursor: exhausted && visible.length <= take ? null : cursor }
}
