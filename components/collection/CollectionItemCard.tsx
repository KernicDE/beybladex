// components/collection/CollectionItemCard.tsx
// Server component: one CollectionItem row in a collection list, shared by /collection (own)
// and /collection/[username] (another user's, privacy-gated by the page before rendering).
// Links to the item detail at /collection/item/[id].
import Link from 'next/link'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { PriceDisplay } from '@/components/collection/PriceDisplay'
import type { FxCurrency } from '@/lib/currency'

export interface CollectionItemCardData {
  id: string
  purchasePrice: number | null
  currency: string
  merchant: string | null
  boughtAt: Date | null
  part: { name: string; category: string; manufacturer: string; imageId: string | null }
}

export function CollectionItemCard({
  item,
  rates,
  stale,
  target,
}: {
  item: CollectionItemCardData
  rates: Record<string, number>
  stale: boolean
  target: FxCurrency
}) {
  return (
    <Card className="p-4">
      <Link href={`/collection/item/${item.id}`} className="block space-y-1">
        <div className="flex items-center gap-2">
          <p className="font-medium">{item.part.name}</p>
          <Badge tone="neutral">{item.part.category}</Badge>
          <Badge tone="neutral">{item.part.manufacturer}</Badge>
        </div>
        <p className="text-sm text-current/60">
          <PriceDisplay price={item.purchasePrice} currency={item.currency} target={target} rates={rates} stale={stale} />
        </p>
        {(item.merchant || item.boughtAt) && (
          <p className="text-sm text-current/60">
            {[item.merchant, item.boughtAt ? new Date(item.boughtAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : null]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
      </Link>
    </Card>
  )
}
