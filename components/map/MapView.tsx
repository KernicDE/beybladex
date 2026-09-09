// components/map/MapView.tsx
// Client-only loading wrapper for LeafletMap. next/dynamic({ ssr: false }) is only allowed in
// Client Components in Next 16, so server pages render this wrapper instead of importing
// LeafletMap directly.
'use client'

import dynamic from 'next/dynamic'
import type { LeafletMapProps } from '@/components/map/LeafletMap'

const LeafletMap = dynamic(() => import('@/components/map/LeafletMap'), { ssr: false })

export function MapView(props: LeafletMapProps) {
  return <LeafletMap {...props} />
}
