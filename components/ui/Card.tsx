// components/ui/Card.tsx
// Shared content container — every phase's lists/detail views wrap content in this
// rather than inventing their own panel styles.
import type { HTMLAttributes, ReactNode } from 'react'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** #157 — "Kontext-Aware-Interaktionen: [...] bei mehrfarbigen Karten/Zeilen über Anheben +
   *  farbige Kante statt Farbinvertierung gelöst (vermeidet Farbkonflikte mit Typ-/Status-
   *  Badges)." Karten tragen oft eigenfarbige Badges (TypeBadge, WinRateBadge, "Im Besitz") —
   *  ein klassisches Hover-Invert/Aufhellen der GANZEN Karte kollidiert visuell damit. `interactive`
   *  hebt die Karte stattdessen leicht an (translate-y + Schatten) und färbt nur den Rand — auf
   *  klickbaren Karten setzen (üblicherweise als Kind eines <Link>), nicht auf statischen. */
  interactive?: boolean
}

export function Card({ className = '', interactive = false, ...rest }: CardProps) {
  return (
    <div
      className={`rounded-xl border border-x-cyan/20 bg-white p-6 shadow-lg dark:bg-base-dark-alt ${
        interactive ? 'transition-all duration-150 hover:-translate-y-0.5 hover:border-x-cyan hover:shadow-xl' : ''
      } ${className}`}
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
