// components/tournament/QrCodeSvg.tsx (hotfix #98)
// Post-hydration injector for server-generated QR SVGs (lib/qr.ts).
//
// WHY NOT dangerouslySetInnerHTML DURING SSR: injecting raw SVG markup into the streamed
// server HTML made /events/[id] crash for logged-in visitors with React hydration errors
// #418/#441 (issue #98). Server HTML and the client's first render must be byte-identical;
// a server-rendered raw-HTML island inside an interactive container (<details>) is exactly
// the fragile spot where that guarantee breaks. This component renders an empty,
// fixed-size placeholder on the server (identical for every viewer) and injects the
// trusted, server-generated SVG in useEffect — after hydration, where no mismatch is
// possible. The QR appears a beat after page load; the layout never shifts.
'use client'

import { useEffect, useState } from 'react'

export function QrCodeSvg({ svg, className = '' }: { svg: string; className?: string }) {
  const [ready, setReady] = useState(false)
  // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: the post-hydration flip IS the point (server HTML stays placeholder-only; the SVG is injected after hydration).
  useEffect(() => setReady(true), [])

  if (!ready) {
    // Fixed-size placeholder keeps the surrounding layout stable until the SVG appears.
    return <div aria-hidden="true" className={`h-48 w-48 ${className}`} />
  }
  // The SVG comes from lib/qr.ts's renderQrSvg over app-controlled URLs/tokens — never user
  // content — so injecting it as raw markup is safe (same trust level as the previous SSR path).
  return <div className={`h-48 w-48 [&_svg]:block [&_svg]:h-full [&_svg]:w-full ${className}`} dangerouslySetInnerHTML={{ __html: svg }} />
}
