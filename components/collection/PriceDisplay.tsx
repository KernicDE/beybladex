// components/collection/PriceDisplay.tsx
// Server component (sync — pages fetch the rate table once and pass it in): renders a stored
// price in its own currency plus one converted "≈ X" hint when the stored currency differs
// from the viewer's hint currency.
//
// UX DECISION (Phase 5 Part B, documented per task spec): the schema has NO per-user currency
// preference field, so the hint target is inferred from the viewer's `User.country`
// (CH → CHF, everything else → EUR; anonymous viewers → EUR). The item's own stored currency
// is always shown as the authoritative price; the hint is approximation ("≈"), and when the
// rate table had to fall back to stale data the hint is marked as such.
import { convert, type FxCurrency } from '@/lib/currency'

const fmt = (currency: string) =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency })

export function PriceDisplay({
  price,
  currency,
  target,
  rates,
  stale,
}: {
  price: number | null
  currency: string
  target: FxCurrency
  rates: Record<string, number>
  stale: boolean
}) {
  if (price == null) return <span className="text-current/50">—</span>

  const stored = fmt(currency).format(price)
  if (currency === target || !(currency in rates)) return <span>{stored}</span>

  const convertedCent = convert(Math.round(price * 100), currency as FxCurrency, target, rates)
  return (
    <span>
      {stored}{' '}
      <span className="text-current/60">
        (≈ {fmt(target).format(convertedCent / 100)}
        {stale && <span title="Wechselkurse derzeit nur aus dem Cache (veraltet)">*</span>})
      </span>
    </span>
  )
}
