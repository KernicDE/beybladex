// components/ui/Badge.tsx
// Small status/count chip. `tone="type-attack"` etc. reuses the Beyblade type palette
// for part types; `cyan`/`green`/`neutral` cover generic statuses.
import type { HTMLAttributes } from 'react'

type Tone = 'neutral' | 'cyan' | 'green' | 'attack' | 'defense' | 'stamina' | 'balance'

const TONES: Record<Tone, string> = {
  neutral: 'bg-current/10 text-current',
  cyan: 'bg-x-cyan/15 text-x-cyan-text dark:text-x-cyan',
  green: 'bg-neon-green/15 text-current',
  attack: 'bg-type-attack/15 text-type-attack',
  defense: 'bg-type-defense/15 text-type-defense',
  stamina: 'bg-type-stamina/20 text-current',
  balance: 'bg-type-balance/15 text-type-balance',
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone
}

export function Badge({ tone = 'neutral', className = '', ...rest }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]} ${className}`}
      {...rest}
    />
  )
}
