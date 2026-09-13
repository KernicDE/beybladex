// lib/ratingAggregate.ts (MVP4, #139/#143)
// Pure shaping für Rating-Aggregate: Prisma aggregate/groupBy-Ergebnisse → kanonische
// { avg, count }-Form. Ein Ziel ohne Bewertungen liefert { avg: null, count: 0 } — die Anzeige
// entscheidet, ob daraus etwas gerendert wird (RatingSummary rendert in dem Fall nichts).
//
// Batch-Variante für #144 (Karten-Durchschnitte in Listen): ein groupBy über alle Ziele —
//   prisma.rating.groupBy({
//     by: ['targetId'],
//     where: { targetType, targetId: { in: ids } },
//     _avg: { stars: true },
//     _count: true,
//   })
// — dann shapeRatingAggregates(rows) → Map<targetId, RatingAggregate>. Fehlende Ziele
// (keine Bewertungen) stehen NICHT in der Map — Aufrufer fallen auf ein Default-Aggregat zurück.
export interface RatingAggregate {
  /** Durchschnitt 1–5, null solange es keine Bewertung gibt. */
  avg: number | null
  count: number
}

/** Zeilenform von prisma.rating.aggregate({ _avg: { stars: true }, _count: true }). */
export interface RatingAggregateRow {
  _avg: { stars: number | null }
  _count: number
}

/** Zeilenform von prisma.rating.groupBy({ by: ['targetId'], _avg: { stars: true }, _count: true }). */
export interface RatingGroupRow extends RatingAggregateRow {
  targetId: string
}

export const EMPTY_RATING_AGGREGATE: RatingAggregate = { avg: null, count: 0 }

export function shapeRatingAggregate(row: RatingAggregateRow | null | undefined): RatingAggregate {
  const count = row?._count ?? 0
  const stars = row?._avg.stars ?? null
  return { avg: count > 0 ? stars : null, count }
}

export function shapeRatingAggregates(rows: RatingGroupRow[]): Map<string, RatingAggregate> {
  const map = new Map<string, RatingAggregate>()
  for (const row of rows) map.set(row.targetId, shapeRatingAggregate(row))
  return map
}
