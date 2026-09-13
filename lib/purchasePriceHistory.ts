// lib/purchasePriceHistory.ts (MVP4, #139/#142)
// Preisverlauf-Aggregat der Beyblade-Detailseite (#139: "Preisverlauf ist dynamisch" — jeder
// gemeldete Kaufpreis ist ein Datenpunkt). Pure shaping: Purchase-Zeilen → Punkte-Listen
// gruppiert nach Währung, chronologisch (boughtAt ?? createdAt — ein Kauf ohne Datum zählt ab
// seiner Meldung). Bewusst KEINE Umrechnung (FX bleibt Sache der Anzeige, #144) und kein
// Charting hier — Geometrie liefert weiterhin lib/priceHistory.ts's shapeSparkline.
export interface PurchasePriceRow {
  price: number | null
  currency: string
  boughtAt: Date | null
  createdAt: Date
}

export interface PriceHistoryPoint {
  price: number
  /** Effektiver Zeitpunkt: Kaufdatum wenn bekannt, sonst Meldedatum. */
  date: Date
}

export type PriceHistorySeries = Record<string, PriceHistoryPoint[]>

export function shapePriceHistory(rows: PurchasePriceRow[]): PriceHistorySeries {
  const series: PriceHistorySeries = {}
  for (const row of rows) {
    if (row.price === null) continue
    const date = row.boughtAt ?? row.createdAt
    ;(series[row.currency] ??= []).push({ price: row.price, date })
  }
  for (const points of Object.values(series)) {
    points.sort((a, b) => a.date.getTime() - b.date.getTime())
  }
  return series
}
