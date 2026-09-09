// lib/currency.ts (Phase 5 Part B)
// Multi-currency display for the collection manager, spec §5 Phase 5 "Mehrwährungsumrechnung".
//
// Two halves, deliberately separated:
//   convert()          — pure, deterministic cent-exact conversion against a caller-supplied
//                        EUR-based rate table. No network, no Redis, no clock — the only part
//                        unit tests touch (fixed fake rate table, never live rates).
//   getRateTable()     — fetch-on-cache-miss (stale-while-revalidate) against the ECB euro
//                        reference rates, the free no-API-key public source [REVIEW-FIX:
//                        privacy-dsgvo #6]: rate requests carry no user-identifying data, so
//                        GDPR transfer analysis is a non-issue (documented in /datenschutz).
//                        This repo is a single container with no worker/cron process, so the
//                        request path is the refresh trigger [REVIEW-FIX: backend-security #15].
//
// Redis topology (standing guard): this uses the `redis` command connection only — never
// `redisSubscriber`. Exact keys/TTLs:
//   fx:rates           — JSON { rates, fetchedAt }, EX 7d. Serves BOTH fresh hits and the
//                        stale fallback: entries stay readable after the 12h freshness window
//                        so a source outage degrades to "last cached rate, stale: true"
//                        instead of an error.
//   fx:rates:refresh   — SET NX PX 30000 — single-flight refresh lock: only one request
//                        refetches from the ECB at a time; losers poll briefly for the winner's
//                        write and otherwise serve stale/fallback. Lock auto-expires after 30s
//                        so a crashed refresher can't wedge the cache.
//
// ECB feed shape (verified 2026-09-09, https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml):
// <Cube time='YYYY-MM-DD'><Cube currency='USD' rate='1.1614'/>…</Cube> — rates are
// "1 EUR = X", EUR itself is absent (normalised to 1).
export type FxCurrency = 'EUR' | 'CHF' | 'USD'
export const FX_CURRENCIES: readonly FxCurrency[] = ['EUR', 'CHF', 'USD']

export const ECB_DAILY_RATES_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'

const CACHE_KEY = 'fx:rates'
const REFRESH_LOCK_KEY = 'fx:rates:refresh'
const FRESH_WINDOW_MS = 12 * 60 * 60 * 1000 // 12h — reference rates update daily; no need for real-time
const CACHE_TTL_S = 7 * 24 * 60 * 60 // 7d — beyond the freshness window, so expired-fresh entries remain as the stale fallback
const REFRESH_LOCK_TTL_MS = 30_000
const FETCH_TIMEOUT_MS = 10_000
const LOCK_POLL_ATTEMPTS = 8
const LOCK_POLL_INTERVAL_MS = 250

// Last-resort table so getRateTable() NEVER throws — not even on the very first call during a
// total outage with an empty cache. Approximate mid-2026 reference levels (EUR-based).
const FALLBACK_RATES: Record<string, number> = { EUR: 1, USD: 1.16, CHF: 0.94 }

// EUR is the table's base and may be absent (the ECB feed omits it) — it is defined as 1.
function rateOf(table: Record<string, number>, currency: FxCurrency): number | undefined {
  return table[currency] ?? (currency === 'EUR' ? 1 : undefined)
}

/** Pure, deterministic: amountCent in `from` → whole cents in `to`, rounded to the nearest cent. */
export function convert(
  amountCent: number,
  from: FxCurrency,
  to: FxCurrency,
  rateTable: Record<string, number>,
): number {
  const fromRate = rateOf(rateTable, from)
  const toRate = rateOf(rateTable, to)
  if (!(fromRate! > 0) || !(toRate! > 0)) {
    throw new RangeError(`currency: rate table lacks positive rates for ${from}/${to}`)
  }
  return Math.round((amountCent * toRate!) / fromRate!)
}

/** Pure: parse the ECB daily XML feed into a EUR-based rate table (EUR normalised to 1). */
export function parseEcbRates(xml: string): Record<string, number> {
  const rates: Record<string, number> = { EUR: 1 }
  const cube = /<Cube\s+currency='([A-Z]{3})'\s+rate='([\d.]+)'\s*\/>/g
  let matches = 0
  for (const m of xml.matchAll(cube)) {
    rates[m[1]!] = Number(m[2])
    matches++
  }
  if (matches === 0) throw new Error('currency: ECB payload contained no rate cubes')
  return rates
}

async function fetchEcbRates(): Promise<Record<string, number>> {
  const res = await fetch(ECB_DAILY_RATES_URL, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'User-Agent': 'beybladex/1.0 (ECB reference rates for collection price display)' },
  })
  if (!res.ok) throw new Error(`currency: ECB fetch failed with HTTP ${res.status}`)
  const rates = parseEcbRates(await res.text())
  // The DACH-relevant pairs must actually be present, otherwise the table is unusable.
  if (!(rates.CHF! > 0) || !(rates.USD! > 0)) throw new Error('currency: ECB payload missing CHF/USD')
  return rates
}

interface CachedRates {
  rates: Record<string, number>
  fetchedAt: number
}

/**
 * Fetch-on-cache-miss rate table. Never throws: any failure (Redis down, ECB unreachable,
 * refresh lock held) degrades to the last cached rate or the built-in fallback, tagged
 * `stale: true`.
 */
export async function getRateTable(): Promise<{ rates: Record<string, number>; stale: boolean }> {
  // Lazy import keeps the pure half of this module (and its unit tests) free of the Redis
  // connection — importing lib/redis requires REDIS_URL even when unused.
  const { redis } = await import('@/lib/redis')

  const readCache = async (): Promise<CachedRates | null> => {
    try {
      const raw = await redis.get(CACHE_KEY)
      return raw ? (JSON.parse(raw) as CachedRates) : null
    } catch {
      return null // Redis down — treat as "no cache" and try a direct fetch below
    }
  }

  const cached = await readCache()
  if (cached && Date.now() - cached.fetchedAt < FRESH_WINDOW_MS) {
    return { rates: cached.rates, stale: false }
  }

  // Stale-while-revalidate: the first caller past the freshness window acquires the lock and
  // refetches; every concurrent caller gets the stale entry immediately (or the fallback).
  let redisUsable = true
  let acquired = false
  try {
    acquired = (await redis.set(REFRESH_LOCK_KEY, '1', 'PX', REFRESH_LOCK_TTL_MS, 'NX')) === 'OK'
  } catch {
    redisUsable = false // Redis down — still try one direct fetch below (no lock possible)
  }

  if (acquired || !redisUsable) {
    // We hold the lock (or Redis is unreachable and nobody can) — we are the refresher.
    try {
      const rates = await fetchEcbRates()
      try {
        await redis.set(CACHE_KEY, JSON.stringify({ rates, fetchedAt: Date.now() } satisfies CachedRates), 'EX', CACHE_TTL_S)
      } catch {
        // Cache write failure is not fatal — serve the fresh rates we just got.
      }
      return { rates, stale: false }
    } catch {
      if (cached) return { rates: cached.rates, stale: true }
      return { rates: FALLBACK_RATES, stale: true }
    }
  }

  // Another request is refreshing right now: poll briefly for its write, else serve stale.
  for (let i = 0; i < LOCK_POLL_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, LOCK_POLL_INTERVAL_MS))
    const refill = await readCache()
    if (refill) {
      return { rates: refill.rates, stale: Date.now() - refill.fetchedAt >= FRESH_WINDOW_MS }
    }
  }
  if (cached) return { rates: cached.rates, stale: true }
  return { rates: FALLBACK_RATES, stale: true }
}
