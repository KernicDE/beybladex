// scripts/prepare-standalone.js
// Mirrors the Dockerfile's runner-stage COPY steps for `.next/standalone` so that running it
// directly (`node .next/standalone/server.js`, as playwright.offline.config.ts does) serves
// static assets and public files identically to the real Docker deployment. Next's standalone
// output traces only the server-side dependency graph — `.next/static` (client chunks) and
// `public/` (favicons, the manifest, public/sw.js) are NOT included and must be copied in
// alongside it, exactly as the Dockerfile already does for the container image.
//
// Without this step, `next start` is used instead (which warns "does not work with
// output: standalone" and silently ignores the standalone build), or `node
// .next/standalone/server.js` runs but 404s on every static asset and public file — either way
// failing to reproduce the actual production runtime an offline/PWA test needs to be honest.
import { cpSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const standalone = join(root, '.next', 'standalone')

if (!existsSync(standalone)) {
  console.error('[prepare-standalone] .next/standalone not found — did `next build` run with output: "standalone" in next.config.ts?')
  process.exit(1)
}

cpSync(join(root, '.next', 'static'), join(standalone, '.next', 'static'), { recursive: true })
cpSync(join(root, 'public'), join(standalone, 'public'), { recursive: true })
console.log('[prepare-standalone] copied .next/static and public/ into .next/standalone')
