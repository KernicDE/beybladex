// components/collection/CollectionItemCard.tsx (#160 — Redesign)
// Server component: one CollectionItem row in a collection list, shared by /collection (own)
// and /collection/[username] (another user's, privacy-gated by the page before rendering).
// Vorher: Preis/Händler/Datum im Vordergrund, kein Bild, keine Drehrichtung, kein Herkunfts-
// Bezug. Jetzt im Vordergrund: Bild, Drehrichtung, und "aus welchem Beyblade stammt das Teil"
// (sourceBeyblade — null bei einzeln hinzugefügten Teilen). Preis/Händler/Kaufdatum bleiben
// als dezente Zweitzeile. Der Haupt-Link geht auf die öffentliche Teile-Detailseite
// (/parts/[id]) statt auf den Sammlungs-Eintrag; "Bearbeiten" (Preis/Preisverlauf/Löschen)
// bleibt über einen eigenen, kleineren Link auf /collection/item/[id] erreichbar.
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { CatalogThumb } from '@/components/beyblade/CatalogThumb'
import { PriceDisplay } from '@/components/collection/PriceDisplay'
import { formatBitDisplay } from '@/lib/buildNaming'
import type { FxCurrency } from '@/lib/currency'
import type { Manufacturer, SpinDirection } from '@prisma/client'

export interface CollectionItemCardData {
  id: string
  purchasePrice: number | null
  currency: string
  merchant: string | null
  boughtAt: Date | null
  sourceBeybladeId: string | null
  sourceBeyblade: { id: string; name: string } | null
  part: { id: string; name: string; category: string; manufacturer: Manufacturer; imageId: string | null; spinDirection: SpinDirection }
}

export function CollectionItemCard({
  item,
  rates,
  stale,
  target,
  editable = true,
}: {
  item: CollectionItemCardData
  rates: Record<string, number>
  stale: boolean
  target: FxCurrency
  /** false auf /collection/[username] (read-only, fremde Sammlung) — kein "Bearbeiten"-Link,
   *  der ohnehin nur die eigene Eintragsseite ohne Edit-UI zeigen würde. Default true (eigene
   *  Sammlung, /collection). */
  editable?: boolean
}) {
  const purchaseLine = [
    item.merchant,
    item.boughtAt ? new Date(item.boughtAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : null,
  ].filter(Boolean)

  const partTitle = item.part.category === 'BIT' ? formatBitDisplay(item.part.name) : item.part.name

  // #188 — die ganze Karte soll auf die Teile-Detailseite verlinkt sein, trägt aber ZWEI
  // weitere, unabhängige Links (Herkunfts-Beyblade, Bearbeiten) — ein <a> darf kein <a>
  // verschachteln, also der "stretched link"-Trick: ein unsichtbarer Vollflächen-Link liegt
  // UNTER dem Karteninhalt; der Inhalt selbst ist `pointer-events-none`, seine eigenen Links
  // schalten sich mit `pointer-events-auto` gezielt wieder ein — Klicks überall sonst auf der
  // Karte fallen durch zum Vollflächen-Link, die beiden echten Links bleiben eigenständig klickbar.
  return (
    <Card className="relative p-4" interactive>
      <Link href={`/parts/${item.part.id}`} className="absolute inset-0" aria-label={partTitle}>
        <span className="sr-only">{partTitle}</span>
      </Link>
      <div className="pointer-events-none flex items-start gap-3">
        <CatalogThumb
          imageId={item.part.imageId}
          alt=""
          size={56}
          manufacturer={item.part.manufacturer}
          spinDirection={item.part.spinDirection}
        />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium">{partTitle}</p>
          {/* #160 — Herkunft im Vordergrund: aus welchem Beyblade stammt das Teil. */}
          {item.sourceBeyblade ? (
            <p className="text-sm text-current/70">
              Aus{' '}
              <Link href={`/beyblades/${item.sourceBeyblade.id}`} className="pointer-events-auto relative underline underline-offset-2">
                {item.sourceBeyblade.name}
              </Link>
            </p>
          ) : (
            <p className="text-sm text-current/50">Einzeln hinzugefügt</p>
          )}
          {/* Kaufangaben bleiben sichtbar, aber dezent — nicht mehr die primäre Information. */}
          {(purchaseLine.length > 0 || item.purchasePrice !== null) && (
            <p className="text-xs text-current/50">
              {item.purchasePrice !== null && (
                <PriceDisplay price={item.purchasePrice} currency={item.currency} target={target} rates={rates} stale={stale} />
              )}
              {item.purchasePrice !== null && purchaseLine.length > 0 && ' · '}
              {purchaseLine.join(' · ')}
            </p>
          )}
          {editable && (
            <Link href={`/collection/item/${item.id}`} className="pointer-events-auto relative inline-block text-xs underline underline-offset-2 text-current/60">
              Bearbeiten
            </Link>
          )}
        </div>
      </div>
    </Card>
  )
}
