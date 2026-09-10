import type { NextConfig } from "next";

// [REVIEW-FIX: backend-security #45] Security headers (incl. CSP) for all routes.
//
// CSP tradeoff, deliberate: static headers() cannot carry per-request nonces, and nonce-based
// CSP (via proxy.ts) would force EVERY page into dynamic rendering — unacceptable for this app.
// So script-src allows 'unsafe-inline': Next.js App Router embeds the RSC/flight payload in
// inline <script> blocks during hydration, which cannot run under a nonce-less strict policy.
// This still blocks the dangerous cases: no 'eval' in production, no cross-origin scripts,
// no injected remote content — a stored-XSS payload cannot load external scripts or exfiltrate
// beyond 'self'. style-src needs 'unsafe-inline' for Leaflet (map containers/tiles get inline
// styles) and React inline style attributes. Every other directive is as strict as the app's
// actually-used resources allow: fonts/icons/Leaflet are vendored locally (see
// tests/unit/no-external-resources.test.ts), map tiles come from same-origin /api/map/tile,
// the service worker is same-origin (/sw.js).
//
// NOT included, deliberately:
// - upgrade-insecure-requests: the playwright offline E2E serves plain HTTP on localhost:3100
//   (playwright.offline.config.ts) and would break if same-origin subresources got upgraded to
//   https. Traefik already redirects http→https in the real deployment.
// - frame-ancestors is 'none' and no page uses iframes (checked: no <iframe>/blob-embed usage).
const isDev = process.env.NODE_ENV === "development";

const contentSecurityPolicy = [
  "default-src 'self'",
  // unsafe-inline: required for Next's inline RSC/flight scripts without nonce support (see above).
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`, // unsafe-eval: React dev error stacks only
  "style-src 'self' 'unsafe-inline'", // Leaflet inline map styles + React style attributes
  "img-src 'self' data: blob:", // data:/blob: for icon sprites and client-side image previews
  "font-src 'self' data:",
  `connect-src 'self'${isDev ? " ws:" : ""}`, // ws: for dev HMR websocket only
  "worker-src 'self'", // PWA service worker public/sw.js
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Browsers ignore HSTS over plain HTTP (and on localhost), so the http://localhost:3100
  // offline E2E is unaffected; it only bites once beybladex.de is served over HTTPS.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" }, // legacy-browser backstop for CSP frame-ancestors
];

const nextConfig: NextConfig = {
  // Required by the Phase 6 Dockerfile: emits .next/standalone so the runtime
  // stage can run the app without node_modules resolution from the repo root.
  output: "standalone",
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
