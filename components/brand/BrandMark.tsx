// components/brand/BrandMark.tsx (Phase 17 item 4)
// The X-Stadium mark as an inline SVG component — same shapes as the generated PWA icons
// (public/icons/*.png, app/icon.png) and app/opengraph-image.tsx, kept in sync by hand since
// each render target (raster PNG, Satori-rendered OG image, live DOM SVG) needs its own copy.
// The gradient is fixed (X-Cyan → Neon-Green) regardless of light/dark theme — the mark reads
// clearly on both the light and dark header backgrounds without a theme-aware color swap.
import { useId } from 'react'

export function BrandMark({ size = 28, className }: { size?: number; className?: string }) {
  // A component-instance-unique gradient id — a fixed id would collide (invalid duplicate IDs)
  // if the mark is ever mounted twice on the same page (e.g. header + footer both use it).
  const gradId = `brand-mark-grad-${useId()}`
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00F0FF" />
          <stop offset="100%" stopColor="#00FF66" />
        </linearGradient>
      </defs>
      <circle cx="256" cy="256" r="192" fill="none" stroke={`url(#${gradId})`} strokeWidth="26" />
      <rect x="226" y="96" width="60" height="320" rx="30" fill={`url(#${gradId})`} transform="rotate(45 256 256)" />
      <rect x="226" y="96" width="60" height="320" rx="30" fill={`url(#${gradId})`} transform="rotate(-45 256 256)" />
    </svg>
  )
}
