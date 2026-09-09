import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  // judge-offline.spec.ts runs against the PRODUCTION server (playwright.offline.config.ts):
  // Next 16 dev mode never hydrates a page reloaded while offline — hydrate() awaits the RSC
  // payload, whose decoder also waits for the HMR-WebSocket-backed dev debug channel, which
  // context.setOffline(true) blocks forever (proven from CI run 34401416295's trace). The app
  // code is not involved; only the production runtime supports the airplane-mode criterion.
  testIgnore: /judge-offline\.spec\.ts/,
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  // The dev server (Turbopack) compiles each route on its FIRST request, not upfront — the
  // webServer.timeout above only covers the base URL becoming reachable at all, not a
  // never-before-hit route's first compile. Heavy client routes (e.g. the judge score pad,
  // with its offline queue/IndexedDB wrapper) can take longer than Playwright's 5s default
  // assertion timeout to first render in a cold CI dev server. 15s gives that headroom.
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: 'http://localhost:3000',
    // Capture a trace/screenshot only on a failing test's first retry — CI text logs alone
    // (the only thing reachable from outside the runner) can't show what the page actually
    // rendered, which is exactly what made this run's first real failure hard to diagnose.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  retries: process.env.CI ? 1 : 0,
})
