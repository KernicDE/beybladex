// app/search/page.tsx
// Typed-sections search skeleton (Task 13). The shared page and the SearchInput
// entry point live here; the RESULT BACKENDS are phased — Phase 3 wires the Events
// section, Phase 4 the Nutzer/Clubs sections, Phase 5 the Teile section. Each phase
// fills its section on this page rather than inventing a separate search UI.
import { EmptyState } from '@/components/ui/EmptyState'

const SECTIONS = [
  { id: 'users', title: 'Nutzer' },
  { id: 'events', title: 'Events' },
  { id: 'clubs', title: 'Clubs' },
  { id: 'parts', title: 'Teile' },
] as const

export default async function SearchPage({ searchParams }: PageProps<'/search'>) {
  const { q } = await searchParams
  const query = typeof q === 'string' ? q : ''

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">Suche</h1>
      {query && (
        <p className="text-current/70">
          Ergebnisse für „{query}“ — die Suche ist noch im Aufbau.
        </p>
      )}
      {SECTIONS.map(({ id, title }) => (
        <section key={id} aria-labelledby={`search-${id}`} className="space-y-3">
          <h2 id={`search-${id}`} className="text-lg font-semibold">
            {title}
          </h2>
          <EmptyState
            title="Suche noch nicht verfügbar"
            description="Dieser Bereich wird in einer späteren Ausbauphase aktiviert."
          />
        </section>
      ))}
    </main>
  )
}
