// components/tournament/EventShareQR.tsx (Phase 7, item 1)
// The simplest of the four QR features: a QR encoding the event's own public URL, rendered
// inline as server-generated SVG (lib/qr.ts) — no schema, no auth, no external image API.
import { renderQrSvg } from '@/lib/qr'

const SITE_URL = process.env.NEXTAUTH_URL ?? 'https://beybladex.de'

export async function EventShareQR({ tournamentId }: { tournamentId: string }) {
  const url = `${SITE_URL}/events/${tournamentId}`
  const svg = await renderQrSvg(url)
  return (
    <details className="rounded-md border border-x-cyan/20 p-3">
      <summary className="cursor-pointer text-sm font-medium">QR-Code teilen</summary>
      <div className="mt-3 flex flex-col items-center gap-2">
        {/* Server-generated SVG from our own trusted lib/qr.ts — not user content. */}
        <div className="[&_svg]:h-48 [&_svg]:w-48" dangerouslySetInnerHTML={{ __html: svg }} />
        <p className="break-all text-center text-xs text-current/60">{url}</p>
      </div>
    </details>
  )
}
