// components/layout/MobileNav.tsx
// Placeholder bottom tab bar — Task 13 replaces the single Start tab with the full
// five-tab model (Start/Events/Decks/Sammlung/Profil).
export function MobileNav() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-x-cyan/20 bg-base-light/90 backdrop-blur dark:bg-base-dark/90 md:hidden">
      <a
        href="/"
        className="flex items-center justify-center px-4 py-3 text-sm font-medium text-x-cyan"
      >
        Start
      </a>
    </nav>
  )
}
