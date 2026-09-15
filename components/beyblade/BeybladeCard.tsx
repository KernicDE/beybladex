// components/beyblade/BeybladeCard.tsx (MVP4/4, #144)
// Katalog-Karte für offizielle Sets (Beyblades-Tab der Sammlung): laut #139 zeigt die LISTE
// nur Name, Typ, Spinrichtung, Hersteller und Bewertung — der Rest bleibt auf der Detailseite.
// Typ/Spinrichtung sind keine Spalten, sie werden aus dem Blade-Teil abgeleitet (Custom Line:
// Lock Chip) — dieselbe Ableitung wie auf der Detailseite (lib/assembly.ts). Die Bewertung
// kommt als Batch-Aggregat vom Listen-Call-Site (ein groupBy für die ganze Seite, nie N
// Einzelqueries). Katalog-Oberflächen sind Deutsch-hardcoded (Idiom wie BuildCard/TypeBadge).
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { CatalogThumb } from '@/components/beyblade/CatalogThumb'
import { TypeBadge } from '@/components/beyblade/TypeBadge'
import { RatingSummary } from '@/components/beyblade/RatingSummary'
import { deriveAssemblyTraits } from '@/lib/assembly'
import type { RatingAggregate } from '@/lib/ratingAggregate'
import type { BeybladeSearchRow } from '@/lib/beybladeSearch'

export function BeybladeCard({
  beyblade,
  rating,
  owned,
}: {
  beyblade: BeybladeSearchRow
  rating?: RatingAggregate | null
  /** #137 — "In Besitz"-Haken; undefined lässt das Badge einfach weg (z. B. andere Call-Sites). */
  owned?: boolean
}) {
  const traits = deriveAssemblyTraits(beyblade.blade, beyblade.lockChip)
  const imageId = beyblade.imageId ?? beyblade.blade?.imageId ?? beyblade.lockChip?.imageId ?? null
  // #157 — dieselbe Anheben+Kante-Hover-Logik wie BuildCard.tsx (mehrfarbige Typ-/Hersteller-/
  // Drehrichtungs-Badges).
  return (
    <Card className="p-4" interactive>
      <Link href={`/beyblades/${beyblade.id}`} className="flex items-center gap-4">
        {/* #188 — Hersteller/Drehrichtung abgekürzt, direkt unter dem Bild (links/rechts
            bündig), statt als volle Badges in der Namenszeile. */}
        <CatalogThumb
          imageId={imageId}
          alt={`Bild zu ${beyblade.name}`}
          size={64}
          manufacturer={beyblade.manufacturer}
          spinDirection={traits?.spinDirection ?? null}
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">
            {beyblade.name}
            {beyblade.productCode && <span className="ml-2 text-xs font-normal text-current/50">{beyblade.productCode}</span>}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {traits?.beyType && <TypeBadge type={traits.beyType} />}
            {owned && <Badge tone="green">✓ Im Besitz</Badge>}
          </div>
          {/* #137 — auch ohne Bewertungen etwas anzeigen (emptyLabel), statt der Karte
              stillschweigend die ganze Zeile fehlen zu lassen. */}
          <div className="mt-1">
            <RatingSummary aggregate={rating ?? { avg: null, count: 0 }} emptyLabel="Noch nicht genug Bewertungen" />
          </div>
        </div>
      </Link>
    </Card>
  )
}
