// components/ui/Card.tsx
// Shared content container — every phase's lists/detail views wrap content in this
// rather than inventing their own panel styles.
import type { HTMLAttributes, ReactNode } from 'react'

export function Card({ className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-xl border border-x-cyan/20 bg-white p-6 shadow-lg dark:bg-base-dark-alt ${className}`}
      {...rest}
    />
  )
}

export function CardTitle({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <h2 className={`text-lg font-semibold ${className}`}>{children}</h2>
}

export function CardContent({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={className}>{children}</div>
}
