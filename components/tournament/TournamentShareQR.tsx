// components/tournament/TournamentShareQR.tsx (Phase 7, item 1; renamed RC6 #69 — internal naming follows the canonical "tournament" term)
// The simplest of the four QR features: a QR encoding the event's own public URL. The SVG is
// generated server-side (lib/qr.ts) but only INJECTED after hydration — see QrCodeSvg for why
// (hotfix #98: raw SSR SVG markup crashed /events/[id] hydration for logged-in visitors).
import { renderQrSvg } from '@/lib/qr'
import { QrCodeSvg } from '@/components/tournament/QrCodeSvg'

const SITE_URL = process.env.NEXTAUTH_URL ?? 'https://beybladex.de'

export async function TournamentShareQR({ tournamentId }: { tournamentId: string }) {
  const url = `${SITE_URL}/events/${tournamentId}`
  const svg = await renderQrSvg(url)
  return (
    <details className="rounded-md border border-x-cyan/20 p-3">
      <summary className="cursor-pointer text-sm font-medium">QR-Code teilen</summary>
      <div className="mt-3 flex flex-col items-center gap-2">
        <QrCodeSvg svg={svg} />
        <p className="break-all text-center text-xs text-current/60">{url}</p>
      </div>
    </details>
  )
}
