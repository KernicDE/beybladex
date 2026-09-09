import { defineConfig } from '@playwright/test'

// Production-server Playwright config for the offline/PWA acceptance spec (judge-offline).
//
// WHY THIS EXISTS (2026-09-09, third CI failure round — root cause PROVEN from the trace of run
// 34401416295): Next 16 dev mode gates hydration on the `/_next/hmr` WebSocket. In
// node_modules/next/dist/client/app-index.js, hydrate() awaits `initialServerResponse`, and the
// bundled RSDW client (react-server-dom-turbopack-client) only closes that response when BOTH the
// inline Flight stream AND the dev `debugChannel` stream close — the debug channel is backed by
// the HMR WebSocket for fresh loads. With `context.setOffline(true)`, the WebSocket can never
// connect (ERR_INTERNET_DISCONNECTED, retried forever), so a dev-server page reloaded while
// offline NEVER HYDRATES: it sits as inert SSR markup with zero console errors. The app's offline
// machinery was proven working in that same trace (SW served the cached document — identical
// Date header — and all chunks; the flush POST was correctly blocked; the queue entry persisted;
// the pre-reload "N Ergebnisse warten auf Sync" assertion passed). The failure is a dev-runtime
// limitation only — judges run the production PWA, so this acceptance criterion is tested here
// against `next build` + `next start`, where hydration has no WebSocket dependency.
//
// Port 3100 keeps this server from clashing with a locally running `npm run dev` on 3000.
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /judge-offline\.spec\.ts/,
  webServer: {
    command: 'npm run start -- -p 3100',
    url: 'http://localhost:3100',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Same-origin auth flows work without it, but keep the canonical URL honest for the port.
      NEXTAUTH_URL: 'http://localhost:3100',
    },
  },
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  retries: process.env.CI ? 1 : 0,
})
