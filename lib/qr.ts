// lib/qr.ts (Phase 7)
// Server-side QR-code SVG rendering — npm-bundled `qrcode`, no external image-generation API
// (api.qrserver.com and similar are explicitly out per the zero-external-CDN policy). Every QR
// consumer in this phase (event share, self-service check-in, arena check-in) renders through
// this one function, inline as SVG markup — never `<img src>` pointed at a third-party host.
import QRCode from 'qrcode'

/** Renders `data` (a URL or token string) as an inline SVG string. */
export async function renderQrSvg(data: string): Promise<string> {
  return QRCode.toString(data, { type: 'svg', margin: 1, width: 240 })
}
