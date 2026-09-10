import path from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, '.') } },
  test: {
    // next-auth@5.0.0-beta.32 imports the extensionless 'next/server' (next 16 ships no
    // package.json exports map, so Node's strict ESM loader cannot resolve it). Externalized
    // deps are loaded with that native loader, so next-auth must be inlined for Vite's resolver.
    server: { deps: { inline: ['next-auth'] } },
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    env: {
      REDIS_URL: 'redis://localhost:6379',
      // dev-only key (same as .env.example) so lib/totpEncryption.ts can construct its AES key in tests
      TOTP_ENCRYPTION_KEY: 'EYNd27+y+waQG7aQScKAHypWJevMkS1wUMcwXHJNhWg=',
    },
    // Playwright e2e specs (tests/e2e) run via `npx playwright test`, not vitest.
    // Both `.worktrees/**` (this repo's own manual-worktree convention) AND
    // `.claude/worktrees/**` (the harness's own Agent-tool worktree isolation, a separate
    // path found the hard way — a leftover agent worktree there duplicated test files and
    // node_modules, causing 28 spurious failures/double React instances on `npm test` until
    // this was added) must be excluded — a nested worktree under either path is not this
    // checkout's own test suite.
    exclude: ['**/node_modules/**', 'tests/e2e/**', '.worktrees/**', '.claude/worktrees/**'],
  },
})
