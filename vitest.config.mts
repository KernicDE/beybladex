import path from 'node:path'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, '.') } },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    env: { REDIS_URL: 'redis://localhost:6379' },
    // Playwright e2e specs (tests/e2e) run via `npx playwright test`, not vitest.
    exclude: ['**/node_modules/**', 'tests/e2e/**', '.worktrees/**'],
  },
})
