// lib/collectionItemBody.ts (Phase 5 Part B; RC4 #55: schema-driven via lib/parseBody.ts)
// Shared body parsing/validation for CollectionItem create + update. Whitelisted fields only;
// `userId` is NEVER accepted here — ownership always comes from the session (the POST/PATCH
// routes own that rule). The CollectionItem schema carries purchasePrice/currency/merchant/
// boughtAt (no condition/notes columns — those fields deliberately don't exist).
import { parseBody, type BodySchema } from '@/lib/parseBody'
import { FX_CURRENCIES, type FxCurrency } from '@/lib/currency'

const MERCHANT_MAX = 120
const PRICE_MAX = 10_000_000

export interface CollectionItemFields {
  partId?: string
  purchasePrice?: number | null
  currency?: FxCurrency
  merchant?: string | null
  boughtAt?: Date | null
}

// purchasePrice keeps its historical Number() coercion for numeric strings; merchant caps by
// slicing (an all-whitespace merchant degrades to null below, as before); boughtAt parses to
// a Date here so routes never touch raw strings.
const COLLECTION_ITEM_SCHEMA: BodySchema = {
  partId: { type: 'string', minLength: 1, token: 'invalid_partId' },
  purchasePrice: { type: 'number', min: 0, max: PRICE_MAX, nullable: true, coerce: true, token: 'invalid_purchasePrice' },
  currency: { type: 'enum', enum: FX_CURRENCIES, token: 'invalid_currency' },
  merchant: { type: 'string', trim: true, emptyNull: true, maxLength: MERCHANT_MAX, nullable: true, token: 'invalid_merchant' },
  boughtAt: { type: 'date', nullable: true, token: 'invalid_boughtAt' },
}

/**
 * @param requirePart POST demands a partId; PATCH treats it as an optional "move to another part".
 */
export function parseCollectionItemBody(body: unknown, opts: { requirePart: boolean }): { fields?: CollectionItemFields; error?: string } {
  const { data, errors } = parseBody(body, COLLECTION_ITEM_SCHEMA, { partial: true })
  // Fail-fast contract preserved: the old validator returned the FIRST error only.
  if (errors.length > 0) return { error: errors[0] }

  const fields = data as CollectionItemFields
  if (opts.requirePart && !fields.partId) return { error: 'invalid_partId' }

  if (fields.purchasePrice !== undefined && fields.purchasePrice !== null) {
    fields.purchasePrice = Math.round(fields.purchasePrice * 100) / 100
  }
  return { fields }
}
