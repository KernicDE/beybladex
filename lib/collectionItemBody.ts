// lib/collectionItemBody.ts (Phase 5 Part B)
// Shared body parsing/validation for CollectionItem create + update. Whitelisted fields only;
// `userId` is NEVER accepted here — ownership always comes from the session (the POST/PATCH
// routes own that rule). The CollectionItem schema carries purchasePrice/currency/merchant/
// boughtAt (no condition/notes columns — those fields deliberately don't exist).
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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

/**
 * @param requirePart POST demands a partId; PATCH treats it as an optional "move to another part".
 */
export function parseCollectionItemBody(body: unknown, opts: { requirePart: boolean }): { fields?: CollectionItemFields; error?: string } {
  if (!isRecord(body)) return { error: 'invalid_body' }
  const fields: CollectionItemFields = {}

  if (body.partId !== undefined) {
    if (typeof body.partId !== 'string' || body.partId.length === 0) return { error: 'invalid_partId' }
    fields.partId = body.partId
  }
  if (opts.requirePart && !fields.partId) return { error: 'invalid_partId' }

  if (body.purchasePrice !== undefined) {
    if (body.purchasePrice === null) {
      fields.purchasePrice = null
    } else {
      const price = Number(body.purchasePrice)
      if (!Number.isFinite(price) || price < 0 || price > PRICE_MAX) return { error: 'invalid_purchasePrice' }
      fields.purchasePrice = Math.round(price * 100) / 100
    }
  }

  if (body.currency !== undefined) {
    if (typeof body.currency !== 'string' || !FX_CURRENCIES.includes(body.currency as FxCurrency)) {
      return { error: 'invalid_currency' }
    }
    fields.currency = body.currency as FxCurrency
  }

  if (body.merchant !== undefined) {
    if (body.merchant === null) {
      fields.merchant = null
    } else {
      if (typeof body.merchant !== 'string') return { error: 'invalid_merchant' }
      fields.merchant = body.merchant.trim().slice(0, MERCHANT_MAX) || null
    }
  }

  if (body.boughtAt !== undefined) {
    if (body.boughtAt === null) {
      fields.boughtAt = null
    } else {
      if (typeof body.boughtAt !== 'string') return { error: 'invalid_boughtAt' }
      const date = new Date(body.boughtAt)
      if (Number.isNaN(date.getTime())) return { error: 'invalid_boughtAt' }
      fields.boughtAt = date
    }
  }

  return { fields }
}
