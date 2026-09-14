// components/layout/Header.tsx
// #157 (Nutzer-Feedback "Verschiebung des Menüs auf die Seite"): die Desktop-Hauptnavigation
// lebt jetzt in components/layout/Sidebar.tsx (sichtbar ab `lg`, siehe deren Kopf-Kommentar).
// Dieser Header bleibt NUR noch für Viewports UNTER `lg` sichtbar (`lg:hidden` unten) — dort
// übernimmt weiterhin er Marke + Utility-Reihe (Suche/Glocke/Nutzermenü); die eigentliche
// Seitennavigation kommt für diese Breiten von MobileNav.tsx' Bottom-Tabs, genau wie vorher (die
// alte <nav>-Leiste hier war ohnehin schon nur ab `lg` sichtbar, für <lg also kein
// Verhaltensunterschied).
// Live-Nachtrag ("Entferne Sprache und Farbschema, das ist entweder vom System oder im
// Nutzermenü"): beide Controls sind komplett aus dem Chrome raus (waren hier wie in
// Sidebar.tsx). Farbschema kommt nur noch aus prefers-color-scheme; Sprache eingeloggt über
// /settings/profile (per UserMenu erreichbar), Gäste über die Browser-Sprache (Accept-Language).
import Link from 'next/link'
import { Search } from 'lucide-react'
import type { Session } from 'next-auth'
import { SearchInput } from '@/components/ui/SearchInput'
import { NotificationBell } from '@/components/layout/NotificationBell'
import { UserMenu } from '@/components/layout/UserMenu'
import { GuestLegalMenu } from '@/components/layout/GuestLegalMenu'
import { BrandMark } from '@/components/brand/BrandMark'
import type { Messages } from '@/lib/i18n/server'

export function Header({ session, avatarImageId, unreadNotifications, t }: { session: Session | null; avatarImageId: string | null; unreadNotifications?: number; t: Messages }) {
  const username = session?.user?.name
  return (
    <header className="sticky top-0 z-40 flex items-center gap-4 border-b border-x-cyan/20 bg-base-light/90 px-4 py-3 backdrop-blur dark:bg-base-dark/90 md:px-8 lg:hidden">
      <Link
        href="/"
        className="flex items-center gap-2 text-lg font-bold tracking-tight text-x-cyan-text dark:text-x-cyan"
      >
        <BrandMark size={26} />
        BeybladeX.de
      </Link>
      <div className="ml-auto flex items-center gap-2">
        {/* #25: mobile search entry — the full input stays md+ only (header space); below
            md a 1-tap icon link leads to /search, which carries its own SearchInput. */}
        <Link
          href="/search"
          aria-label={t.common.search}
          className="rounded-md p-2 text-current/80 transition-colors hover:bg-current/5 hover:text-current md:hidden"
        >
          <Search size={18} aria-hidden="true" />
        </Link>
        <SearchInput
          className="hidden w-56 md:block"
          placeholder={t.common.searchPlaceholder}
          submitLabel={t.common.search}
        />
        {session && <NotificationBell unreadCount={unreadNotifications ?? 0} />}
        {session ? (
          <UserMenu username={username ?? ''} avatarImageId={avatarImageId} />
        ) : (
          <>
            {/* Guests have no other path to the legal pages below `md` — the Footer is
                desktop-only and UserMenu only renders for a session (issue #22). */}
            <GuestLegalMenu />
            <Link
              href="/login"
              className="rounded-md px-3 py-1.5 text-sm font-medium text-current/80 transition-colors hover:bg-current/5 hover:text-current"
            >
              {t.common.login}
            </Link>
          </>
        )}
      </div>
    </header>
  )
}
