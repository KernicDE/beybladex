// lib/purchaseInput.ts (MVP4, #139/#142)
// Shared body parsing/validation for Purchase create (#142: POST /api/beyblades/[id]/purchases)
// and edit (PATCH /api/purchases/[id]). Schema-driven via lib/parseBody.ts, whitelisted fields
// only — `userId`/`beybladeId` kommen nie aus dem Body (AUTHZ: owner = session.user.id, die
// Routes besitzen diese Regel). Alle Felder sind optional: der Kauf-Dialog fragt erst NACH dem
// Markieren ("Als gekauft markieren" ohne Angaben ist der Normalfall, #139).
import { parseBody, type BodySchema } from '@/lib/parseBody'
import { FX_CURRENCIES, type FxCurrency } from '@/lib/currency'

const MERCHANT_MAX = 120
const PRICE_MAX = 10_000_000
// Toleranz für die "nicht in der Zukunft"-Regel: ein per <input type="date"> geliefertes
// 'YYYY-MM-DD' parst zu UTC-Mitternacht — für Viewer in UTC+X ist "heute" damit bis zu X
// Stunden in der Zukunft. Ein Tag Spielraum verhindert diesen Timezone-Fehlgriff, blockt
// aber echte Zukunftsdaten weiterhin zuverlässig (ein Preisverlaufspunkt von "morgen" ist
// datenschrott, der nur explizit überschrieben werden soll).
const FUTURE_GRACE_MS = 24 * 60 * 60 * 1000

export interface PurchaseFields {
  merchant?: string | null
  boughtAt?: Date | null
  price?: number | null
  currency?: FxCurrency
}

const PURCHASE_SCHEMA: BodySchema = {
  merchant: { type: 'string', trim: true, emptyNull: true, maxLength: MERCHANT_MAX, nullable: true, token: 'invalid_merchant' },
  boughtAt: { type: 'date', nullable: true, token: 'invalid_boughtAt' },
  price: { type: 'number', min: 0, max: PRICE_MAX, nullable: true, coerce: true, token: 'invalid_price' },
  currency: { type: 'enum', enum: FX_CURRENCIES, token: 'invalid_currency' },
}

/**
 * POST und PATCH teilen die komplette Feld-Validierung (alle Felder optional, partial).
 * Fail-fast wie die anderen Validatoren: nur der erste Fehler wird zurückgegeben.
 */
export function parsePurchaseBody(body: unknown): { fields?: PurchaseFields; error?: string } {
  const { data, errors } = parseBody(body, PURCHASE_SCHEMA, { partial: true })
  if (errors.length > 0) return { error: errors[0] }

  const fields = data as PurchaseFields
  if (fields.boughtAt && fields.boughtAt.getTime() > Date.now() + FUTURE_GRACE_MS) {
    return { error: 'invalid_boughtAt' }
  }
  if (fields.price !== undefined && fields.price !== null) {
    fields.price = Math.round(fields.price * 100) / 100
  }
  return { fields }
}
