// lib/priceHistory.ts (Phase 5 Part B)
// Preisverlauf: pure shaping of PricePoint rows into sparkline geometry for
// app/collection/item/[id]'s inline SVG (no charting library — a handful of points).
// Deliberately free of Prisma/React so the ordering and coordinate math is unit-testable.
export interface PriceObservation {
  price: number
  recordedAt: Date | string
}

export interface SparklineGeometry {
  width: number
  height: number
  /** SVG path: "M x,y L x,y …" in viewBox coordinates. */
  path: string
  /** The plotted vertices in time order (oldest → newest). */
  vertices: { x: number; y: number }[]
  min: number
  max: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Sort observations by recordedAt (oldest first) and map them into a fixed viewBox.
 * Returns null when fewer than 2 points exist — the UI hides the sparkline then, since a
 * single observation carries no "Verlauf". A constant series renders as a flat mid-height
 * line (min === max), not a divide-by-zero.
 */
export function shapeSparkline(
  observations: PriceObservation[],
  opts: { width?: number; height?: number; pad?: number } = {},
): SparklineGeometry | null {
  if (observations.length < 2) return null

  const width = opts.width ?? 240
  const height = opts.height ?? 80
  const pad = opts.pad ?? 8

  const sorted = [...observations].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
  )
  const prices = sorted.map((o) => o.price)
  const min = Math.min(...prices)
  const max = Math.max(...prices)

  const xAt = (i: number) => pad + (i / (sorted.length - 1)) * (width - 2 * pad)
  const yAt = (p: number) => (max === min ? height / 2 : pad + (1 - (p - min) / (max - min)) * (height - 2 * pad))

  const vertices = sorted.map((o, i) => ({ x: round2(xAt(i)), y: round2(yAt(o.price)) }))
  const path = `M ${vertices.map((v) => `${v.x},${v.y}`).join(' L ')}`

  return { width, height, path, vertices, min, max }
}
