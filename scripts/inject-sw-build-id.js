// Replaces the __SW_BUILD_ID__ placeholder token in public/sw.js with a fresh build identifier
// before `next build` copies public/ into the output, so every deploy ships a distinct SW cache
// namespace (see plan Task 8, REVIEW-FIX C3/I10).
//
// Approach: idempotent inject + postbuild restore, chosen over a separate template file so the
// committed public/sw.js remains the single source of truth and always contains the literal
// placeholder token (no generated build artifact to gitignore).
//
// Usage:
//   node scripts/inject-sw-build-id.js          # inject a fresh build ID (npm prebuild)
//   node scripts/inject-sw-build-id.js --restore # put the placeholder back (npm postbuild)
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SW_PATH = join(process.cwd(), 'public', 'sw.js')
const PLACEHOLDER = '__SW_BUILD_ID__'
// Matches a previously injected single-quoted build ID on the BUILD_ID line (base36 timestamp,
// or the literal placeholder), so repeated inject runs stay idempotent.
const BUILD_ID_LINE = /const BUILD_ID = '[^']*'/

const source = readFileSync(SW_PATH, 'utf-8')

if (process.argv.includes('--restore')) {
  writeFileSync(SW_PATH, source.replace(BUILD_ID_LINE, `const BUILD_ID = '${PLACEHOLDER}'`))
  console.log('[inject-sw-build-id] restored __SW_BUILD_ID__ placeholder in public/sw.js')
} else {
  const next = source.replace(BUILD_ID_LINE, `const BUILD_ID = '${Date.now().toString(36)}'`)
  writeFileSync(SW_PATH, next)
  console.log('[inject-sw-build-id] injected fresh build ID into public/sw.js')
}
