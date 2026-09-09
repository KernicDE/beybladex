// components/collection/PriceSparkline.tsx
// Server component: inline-SVG sparkline of a CollectionItem's PricePoints over time.
// No charting library — a handful of points. Hidden entirely when fewer than 2 observations
// exist (a single point is no "Verlauf"); geometry comes from the pure lib/priceHistory.ts.
import { shapeSparkline } from '@/lib/priceHistory'

export function PriceSparkline({ points }: { points: { price: number; recordedAt: Date }[] }) {
  const shaped = shapeSparkline(points)
  if (!shaped) return null

  return (
    <figure>
      <svg
        viewBox={`0 0 ${shaped.width} ${shaped.height}`}
        role="img"
        aria-label={`Preisverlauf von ${shaped.min.toFixed(2)} bis ${shaped.max.toFixed(2)} über ${points.length} Einträge`}
        className="h-20 w-full max-w-xs"
      >
        <title>
          Preisverlauf: {shaped.min.toFixed(2)} – {shaped.max.toFixed(2)} ({points.length} Einträge)
        </title>
        <path d={shaped.path} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {shaped.vertices.map((v, i) => (
          <circle key={i} cx={v.x} cy={v.y} r={2.5} fill="currentColor" />
        ))}
      </svg>
    </figure>
  )
}
