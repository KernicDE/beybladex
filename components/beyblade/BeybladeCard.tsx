// components/beyblade/BeybladeCard.tsx (MVP4/4, #144)
// Katalog-Karte für offizielle Sets (Beyblades-Tab der Sammlung): laut #139 zeigt die LISTE
// nur Name, Typ, Spinrichtung, Hersteller und Bewertung — der Rest bleibt auf der Detailseite.
// Typ/Spinrichtung sind keine Spalten, sie werden aus dem Blade-Teil abgeleitet (Custom Line:
// Lock Chip) — dieselbe Ableitung wie auf der Detailseite (lib/assembly.ts). Die Bewertung
// kommt als Batch-Aggregat vom Listen-Call-Site (ein groupBy für die ganze Seite, nie N
// Einzelqueries). Katalog-Oberflächen sind Deutsch-hardcoded (Idiom wie BuildCard/TypeBadge).
import Image from 'next/image'
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
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
  return (
    <Card className="p-4">
      <Link href={`/beyblades/${beyblade.id}`} className="flex items-center gap-4">
        {imageId ? (
          <Image
            src={`/api/media/${imageId}`}
            alt={`Bild zu ${beyblade.name}`}
            width={64}
            height={64}
            sizes="64px"
            className="h-16 w-16 rounded-lg object-contain"
          />
        ) : (
          <div aria-hidden="true" className="h-16 w-16 rounded-lg bg-x-cyan/10" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">
            {beyblade.name}
            {beyblade.productCode && <span className="ml-2 text-xs font-normal text-current/50">{beyblade.productCode}</span>}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            {/* #137 — Hersteller/Drehrichtung farblich unterscheidbar statt beide neutral-grau. */}
            <Badge tone={beyblade.manufacturer === 'TT' ? 'cyan' : 'neutral'}>
              {beyblade.manufacturer === 'TT' ? 'Takara Tomy' : 'Hasbro'}
            </Badge>
            {traits?.spinDirection && (
              <Badge tone={traits.spinDirection === 'RIGHT' ? 'attack' : 'defense'}>
                {traits.spinDirection === 'RIGHT' ? 'Rechtsdrehend' : 'Linksdrehend'}
              </Badge>
            )}
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
