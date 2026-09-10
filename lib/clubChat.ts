// lib/clubChat.ts (Phase 12)
// Per-club chat stream helpers. Real-time delivery reuses the Phase 3 notification SSE
// architecture: a per-club Redis pub/sub channel (`club-chat:{clubId}`). Publishes go through
// the command connection (`redis`); the SSE route at app/api/clubs/[slug]/messages/stream
// subscribes on `redisSubscriber` — never the command connection (a subscriber-mode ioredis
// connection rejects ordinary commands — see lib/redis.ts).
import { redis } from '@/lib/redis'

// The stream is capped at this many messages (Phase 12 sizing decision: casual live chat,
// not a permanent record — older messages are deleted, not archived).
export const CLUB_MESSAGE_CAP = 50

export const clubChatChannel = (clubId: string) => `club-chat:${clubId}`

// The message row as delivered to SSE clients (shape shared by the route handlers and the
// ClubChat client component). authorName is the author's CURRENT username — a plain-string
// authorId means an erased author stays attached to their anonymized row
// (`geloescht_…` / "Gelöschter Nutzer"), which is exactly the Phase 12 requirement.
export interface ClubChatMessagePayload {
  id: string
  clubId: string
  authorId: string
  authorName: string
  body: string
  createdAt: string
}

export async function publishClubMessage(message: ClubChatMessagePayload): Promise<void> {
  await redis.publish(clubChatChannel(message.clubId), JSON.stringify(message))
}
