// app/opengraph-image.tsx (Phase 17 item 3)
// Next.js's built-in OG-image convention — generated server-side via ImageResponse (Satori
// under the hood), no external image-generation API, consistent with the zero-external-CDN
// policy (tests/unit/no-external-resources.test.ts). Renders once per unique request and is
// cached by Next; system font stack only, no @font-face/Google Fonts import.
import { ImageResponse } from 'next/og'

export const alt = 'BeybladeX.de — die DACH-Community für Beyblade X'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 32,
          backgroundColor: '#090D16',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {/* The X-Stadium mark, inlined — same shapes as public/icons/*.png and app/icon.png,
            kept in sync by hand (Satori's SVG support is a subset of full SVG; a plain inline
            <svg> with basic shapes renders reliably here). */}
        <svg width="140" height="140" viewBox="0 0 512 512">
          <defs>
            <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#00F0FF" />
              <stop offset="100%" stopColor="#00FF66" />
            </linearGradient>
          </defs>
          <circle cx="256" cy="256" r="192" fill="none" stroke="url(#grad)" strokeWidth="26" />
          <rect x="226" y="96" width="60" height="320" rx="30" fill="url(#grad)" transform="rotate(45 256 256)" />
          <rect x="226" y="96" width="60" height="320" rx="30" fill="url(#grad)" transform="rotate(-45 256 256)" />
        </svg>
        <div style={{ display: 'flex', fontSize: 72, fontWeight: 700, color: '#F4F4F5' }}>
          BeybladeX<span style={{ color: '#00F0FF' }}>.de</span>
        </div>
        <div style={{ display: 'flex', fontSize: 30, color: '#A1A1AA' }}>
          Turniere · Regeln · Decks · Sammlung · Clubs
        </div>
      </div>
    ),
    { ...size }
  )
}
