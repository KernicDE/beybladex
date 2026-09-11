// components/clubs/ClubJoinPolicyBadge.tsx
// Join-policy chip shared by every club surface (list cards, detail page): OPEN joins
// immediately, APPLICATION requires an approved request, INVITE_ONLY offers no self-service
// join at all. One label/tone mapping here so all surfaces word policies identically.
import type { ClubJoinPolicy } from '@prisma/client'
import { Badge } from '@/components/ui/Badge'

const POLICY_PRESENTATION: Record<ClubJoinPolicy, { label: string; tone: 'green' | 'cyan' | 'neutral' }> = {
  OPEN: { label: 'Offen', tone: 'green' },
  APPLICATION: { label: 'Bewerbung', tone: 'cyan' },
  INVITE_ONLY: { label: 'Auf Einladung', tone: 'neutral' },
}

export function ClubJoinPolicyBadge({ policy }: { policy: ClubJoinPolicy }) {
  const { label, tone } = POLICY_PRESENTATION[policy]
  return <Badge tone={tone}>{label}</Badge>
}
