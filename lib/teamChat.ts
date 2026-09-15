// lib/teamChat.ts (issue #198)
// Per-team chat stream helpers. Mirrors lib/clubChat.ts exactly — a per-team Redis pub/sub
// channel (`team-chat:{teamId}`). Publishes go through the command connection (`redis`); the
// SSE route at app/api/teams/[slug]/messages/stream subscribes on `redisSubscriber`.
import { redis } from '@/lib/redis'

// Same sizing decision as Club chat: casual live chat, not a permanent record.
export const TEAM_MESSAGE_CAP = 50

export const teamChatChannel = (teamId: string) => `team-chat:${teamId}`

export interface TeamChatMessagePayload {
  id: string
  teamId: string
  authorId: string
  authorName: string
  body: string
  createdAt: string
}

export async function publishTeamMessage(message: TeamChatMessagePayload): Promise<void> {
  await redis.publish(teamChatChannel(message.teamId), JSON.stringify(message))
}
