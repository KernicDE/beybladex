// components/home/LandingScreenshotMockups.tsx (RC13 issue #88)
// Real production screenshots of the guest-facing pages in "browser window" frames for the
// landing page's gallery section. The shots live in public/screenshots/ (captured from
// https://beybladex.de at 1280×800, deviceScaleFactor 2, above-the-fold, WebP ~quality 80)
// and render via next/image with explicit sizing. The window chrome stays decorative
// (aria-hidden); each screenshot carries a meaningful alt text and the figure is labeled by
// its visible figcaption. /builds and /decks redirect guests to /login, so the third slot
// shows the public /rangliste instead of a deck-builder shot.
import Image from 'next/image'

interface ScreenshotFrame {
  src: string
  /** Chrome address-bar label — decorative. */
  label: string
  /** Accessible description of the screenshot. */
  alt: string
  /** Visible figcaption; doubles as the figure's accessible name. */
  caption: string
}

const FRAMES: ScreenshotFrame[] = [
  {
    src: '/screenshots/events.webp',
    label: 'beybladex.de/events',
    alt: 'Screenshot des Turnier- und Event-Kalenders mit DACH-Karte, Filterfeldern und Event-Liste auf beybladex.de/events',
    caption: 'Event-Kalender mit DACH-Karte',
  },
  {
    src: '/screenshots/clubs.webp',
    label: 'beybladex.de/clubs',
    alt: 'Screenshot der Club-Übersicht mit Clubsuche und Club-Karte auf beybladex.de/clubs',
    caption: 'Clubs & Community',
  },
  {
    src: '/screenshots/rangliste.webp',
    label: 'beybladex.de/rangliste',
    alt: 'Screenshot der öffentlichen Rangliste mit Saison-Status auf beybladex.de/rangliste',
    caption: 'Rangliste & Elo',
  },
]

function BrowserFrame({ src, label, alt, caption }: ScreenshotFrame) {
  return (
    <figure
      aria-label={caption}
      className="overflow-hidden rounded-xl border border-x-cyan/20 bg-white shadow-lg dark:bg-base-dark-alt"
    >
      {/* Window chrome — three dots, purely decorative. */}
      <div aria-hidden="true" className="flex items-center gap-1.5 border-b border-current/10 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-current/20" />
        <span className="h-2.5 w-2.5 rounded-full bg-current/20" />
        <span className="h-2.5 w-2.5 rounded-full bg-current/20" />
        <span className="ml-2 truncate text-xs text-current/50">{label}</span>
      </div>
      {/* Shots are 2560×1600 (1280×800 @2x); rendered at a 16:10 block that scales with the column. */}
      <Image
        src={src}
        alt={alt}
        width={1280}
        height={800}
        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
        className="block h-auto w-full"
      />
      <figcaption className="px-4 py-2 text-xs text-current/50">{caption}</figcaption>
    </figure>
  )
}

export function LandingScreenshotMockups() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {FRAMES.map((frame) => (
        <BrowserFrame key={frame.src} {...frame} />
      ))}
    </div>
  )
}
