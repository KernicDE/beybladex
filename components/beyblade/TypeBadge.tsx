// components/beyblade/TypeBadge.tsx
// Beyblade-type chip — renders the type-attack/type-defense/type-stamina/type-balance
// Tailwind tokens from Phase 1 Task 1 via the shared Badge primitive.
import { Badge } from '@/components/ui/Badge'

const TONE = { ATTACK: 'attack', DEFENSE: 'defense', STAMINA: 'stamina', BALANCE: 'balance' } as const
const LABEL = { ATTACK: 'Angriff', DEFENSE: 'Verteidigung', STAMINA: 'Ausdauer', BALANCE: 'Balance' } as const

export function TypeBadge({ type, className }: { type: keyof typeof TONE; className?: string }) {
  return <Badge tone={TONE[type]} className={className}>{LABEL[type]}</Badge>
}
