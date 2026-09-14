// tests/unit/hero-gradient-no-light-mode-trap.test.ts (#157 Phase 4)
// .x-hero (app/globals.css) renders white text over a red→dark gradient. The reference mockup's
// OWN gradient fades to `var(--bg)` — which flips to near-white in light mode, creating a WCAG
// trap (white text over a near-white patch mid-gradient). This project's .x-hero deliberately
// fades to the FIXED --color-base-dark instead, regardless of theme — this test guards that
// decision: if someone "matches the mockup more closely" later and swaps in var(--bg), this
// fails instead of shipping an illegible light-mode heading.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

describe('.x-hero gradient stays a fixed dark surface (#157 Phase 4)', () => {
  it('does not reference the theme-dependent --bg token (would go near-white in light mode)', () => {
    const css = readFileSync(path.resolve(import.meta.dirname, '../../app/globals.css'), 'utf8')
    const match = css.match(/\.x-hero\s*\{[^}]*\}/)
    expect(match, '.x-hero rule not found in app/globals.css').toBeTruthy()
    expect(match![0]).not.toContain('var(--bg)')
    expect(match![0]).toContain('var(--color-base-dark)')
  })
})
