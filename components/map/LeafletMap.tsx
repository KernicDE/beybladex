// components/map/LeafletMap.tsx
// Leaflet map fed exclusively by the /api/map/tile/[z]/[x]/[y] proxy (Phase 1 Task 4) — the
// browser never contacts openstreetmap.org directly (Global Constraints). The ODbL attribution
// ("© OpenStreetMap contributors") is rendered as a visible attribution control; proxying tiles
// does not remove that obligation. Marker icons are constructed from explicitly imported PNG
// URLs because Leaflet's default CSS-relative icon paths break under Next.js's asset pipeline
// [REVIEW-FIX: frontend-pwa I6]. Only ever rendered through MapView's next/dynamic({ ssr: false })
// wrapper — Leaflet touches `window` and can't prerender.
'use client'

import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2xUrl from 'leaflet/dist/images/marker-icon-2x.png'
import markerIconUrl from 'leaflet/dist/images/marker-icon.png'
import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png'

export interface MapMarker {
  id: string
  lat: number
  lng: number
  label: string
  href?: string
}

export interface LeafletMapProps {
  center: { lat: number; lng: number }
  zoom?: number
  markers?: MapMarker[]
  className?: string
}

L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2xUrl,
  iconUrl: markerIconUrl,
  shadowUrl: markerShadowUrl,
})

const TILE_URL = '/api/map/tile/{z}/{x}/{y}.png'
const ATTRIBUTION = '© OpenStreetMap contributors'

export default function LeafletMap({ center, zoom = 7, markers = [], className = '' }: LeafletMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, { center, zoom, attributionControl: true })
    L.tileLayer(TILE_URL, {
      maxZoom: 19,
      attribution: ATTRIBUTION, // renders the visible "© OpenStreetMap contributors" control
    }).addTo(map)
    mapRef.current = map
    return () => {
      map.remove()
      mapRef.current = null
    }
    // The map is constructed once per mount; center/zoom/markers update via separate effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    mapRef.current?.setView(center, mapRef.current.getZoom() ?? zoom)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center.lat, center.lng])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const layer = L.layerGroup().addTo(map)
    for (const marker of markers) {
      const m = L.marker([marker.lat, marker.lng]).addTo(layer)
      if (marker.href) {
        m.bindPopup(`<a href="${marker.href}">${escapeHtml(marker.label)}</a>`)
      } else {
        m.bindPopup(escapeHtml(marker.label))
      }
    }
    return () => {
      layer.remove()
    }
  }, [markers])

  return <div ref={containerRef} className={className} role="application" aria-label="Karte" />
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}
