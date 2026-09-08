// components/layout/Header.tsx
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import type { Session } from 'next-auth'

export function Header({ session }: { session: Session | null }) {
  return (
    <header className="sticky top-0 z-40 flex items-center justify-between border-b border-x-cyan/20 bg-base-light/90 px-4 py-3 backdrop-blur dark:bg-base-dark/90 md:px-8">
      <span className="text-lg font-bold tracking-tight text-x-cyan">BeybladeX.de</span>
      <div className="flex items-center gap-3">
        <ThemeToggle />
        {session ? <span className="text-sm">{session.user?.name}</span> : <a href="/login" className="text-sm">Login</a>}
      </div>
    </header>
  )
}
