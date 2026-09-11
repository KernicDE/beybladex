// components/home/LandingScreenshotMockups.tsx (RC13 issue #88)
// Decorative stand-ins for real app screenshots in the guest landing page's gallery
// section. No final screenshot assets exist yet in the repo (public/ has only icons and
// fonts), so per #88's fallback allowance these frames render stylized skeleton UIs built
// exclusively from the app's own design tokens — inside "browser window" frames, clearly
// labeled as previews, each carrying a visible "Screenshot folgt" marker and a code TODO
// pointing at the asset-replacement task.
// Everything inside the frames is decorative (aria-hidden); the frame itself exposes the
// feature name as an accessible label.
import type { ReactNode } from 'react'
import { MapPin } from 'lucide-react'

function BrowserFrame({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure
      aria-label={`Vorschau: ${label}`}
      className="overflow-hidden rounded-xl border border-x-cyan/20 bg-white shadow-lg dark:bg-base-dark-alt"
    >
      {/* Window chrome — three dots, purely decorative. */}
      <div aria-hidden="true" className="flex items-center gap-1.5 border-b border-current/10 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-current/20" />
        <span className="h-2.5 w-2.5 rounded-full bg-current/20" />
        <span className="h-2.5 w-2.5 rounded-full bg-current/20" />
        <span className="ml-2 truncate text-xs text-current/50">{label}</span>
      </div>
      {children}
      {/* TODO(assets): replace each frame's skeleton content with a real app screenshot
          (checked in under public/, rendered via next/image) before launch — see issue #88. */}
      <figcaption className="px-4 py-2 text-xs text-current/50">
        Vorschau — finaler Screenshot folgt
      </figcaption>
    </figure>
  )
}

function SkeletonBar({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`rounded bg-current/10 ${className}`} />
}

function EventsMockup() {
  return (
    <BrowserFrame label="beybladex.de/events">
      <div aria-hidden="true" className="space-y-3 p-4">
        <SkeletonBar className="h-5 w-40" />
        {[
          ['w-3/4', 'w-1/2'],
          ['w-2/3', 'w-2/5'],
          ['w-3/5', 'w-1/3'],
        ].map(([title, meta], i) => (
          <div key={i} className="space-y-1.5 rounded-lg border border-x-cyan/20 p-3">
            <SkeletonBar className={`h-3.5 ${title}`} />
            <SkeletonBar className={`h-3 ${meta}`} />
          </div>
        ))}
      </div>
    </BrowserFrame>
  )
}

function ClubMapMockup() {
  return (
    <BrowserFrame label="beybladex.de/clubs">
      {/* Stylized map: token-tinted panel with decorative pins. */}
      <div aria-hidden="true" className="relative h-44 bg-x-cyan/10 dark:bg-x-cyan/5">
        <div className="absolute left-[15%] top-[30%]">
          <MapPin size={22} className="text-x-cyan-text dark:text-x-cyan" />
        </div>
        <div className="absolute left-[55%] top-[55%]">
          <MapPin size={22} className="text-x-cyan-text dark:text-x-cyan" />
        </div>
        <div className="absolute left-[75%] top-[20%]">
          <MapPin size={22} className="text-x-cyan-text dark:text-x-cyan" />
        </div>
        <div className="absolute bottom-2 left-2 rounded bg-base-light/90 px-2 py-1 text-[10px] text-current/60 dark:bg-base-dark/90">
          DACH-Karte
        </div>
      </div>
    </BrowserFrame>
  )
}

function DeckBuilderMockup() {
  return (
    <BrowserFrame label="beybladex.de/decks">
      <div aria-hidden="true" className="space-y-3 p-4">
        <SkeletonBar className="h-5 w-32" />
        <div className="flex gap-2">
          <div className="h-12 w-12 rounded-full border-2 border-type-attack" />
          <div className="h-12 w-12 rounded-full border-2 border-type-defense" />
          <div className="h-12 w-12 rounded-full border-2 border-type-stamina" />
        </div>
        {[
          ['bg-type-attack', 'w-4/5'],
          ['bg-type-defense', 'w-3/5'],
          ['bg-type-stamina', 'w-2/3'],
          ['bg-type-balance', 'w-1/2'],
        ].map(([color, width], i) => (
          <div key={i} className="h-2.5 rounded bg-current/10">
            <div className={`h-2.5 rounded ${color} ${width}`} />
          </div>
        ))}
      </div>
    </BrowserFrame>
  )
}

export function LandingScreenshotMockups() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <EventsMockup />
      <ClubMapMockup />
      <DeckBuilderMockup />
    </div>
  )
}
