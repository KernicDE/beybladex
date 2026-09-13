// components/beyblade/RatingSummary.tsx (MVP4 #143)
// Sterne-Durchschnitt + Anzahl für Header/Karten der Detailseiten (Beyblade, Build, Teil) —
// reine Anzeige aus dem kanonischen Aggregat (lib/ratingAggregate.ts). Rendert NICHTS, wenn
// es noch keine Bewertung gibt (die Seiten zeigen dann schlicht nichts statt „Ø 0.0").
// Füllstand = gerundeter Durchschnitt, Farben wie überall: gefüllt gold, leer grau.
import type { RatingAggregate } from '@/lib/ratingAggregate'

export function RatingSummary({ aggregate }: { aggregate: RatingAggregate }) {
  if (aggregate.avg === null || aggregate.count === 0) return null
  const filled = Math.round(aggregate.avg)
  return (
    <p
      className="flex flex-wrap items-center gap-1.5 text-sm text-current/60"
      aria-label={`Durchschnitt ${aggregate.avg.toFixed(1)} von 5 Sternen aus ${aggregate.count} Bewertungen`}
    >
      <span aria-hidden="true" className="text-base leading-none">
        <span className="text-type-stamina">{'★'.repeat(filled)}</span>
        <span className="text-current/30">{'★'.repeat(5 - filled)}</span>
      </span>
      <span>
        Ø {aggregate.avg.toFixed(1)} · {aggregate.count} Bewertung{aggregate.count === 1 ? '' : 'en'}
      </span>
    </p>
  )
}
