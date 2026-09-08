// components/ui/EmptyState.tsx
// Standard "nothing here yet / no results" block — every list view renders this
// instead of a blank area. `action` holds the contextual CTA (e.g. the
// anonymous-vs-member "Anmelden, um fortzufahren" prompt).
import type { ReactNode } from 'react'

export interface EmptyStateProps {
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-x-cyan/20 px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {description && <p className="text-sm text-current/60">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}
