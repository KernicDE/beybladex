// tests/unit/contrast.test.ts
// PERMANENT regression guard (Task 13): the x-cyan-text token must keep clearing
// WCAG AA (≥4.5:1) on the light backgrounds it renders on. Originally guarded the
// literal X-Cyan #00F0FF (~1.5:1, illegible as text). #157 Phase 1 repointed the
// x-cyan/x-cyan-text tokens at the new red brand palette (token NAMES kept — see
// app/globals.css's comment on that decision) — the raw accent (#C22436) now
// clears AA outright, unlike the old cyan, but the darker -text variant (#7A1522)
// stays as the deliberately safer choice for body text. Real contrast math, not a
// hardcoded pass: the token hex is read from app/globals.css and the WCAG 2.x
// relative-luminance formula is computed here.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect } from 'vitest'

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ]
}

// WCAG 2.x relative luminance (https://www.w3.org/TR/WCAG21/#dfn-relative-luminance)
function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4),
  )
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1)
  const l2 = relativeLuminance(hex2)
  const [lighter, darker] = l1 >= l2 ? [l1, l2] : [l2, l1]
  return (lighter + 0.05) / (darker + 0.05)
}

function readToken(name: string): string {
  const css = readFileSync(path.resolve(import.meta.dirname, '../../app/globals.css'), 'utf8')
  const match = css.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`))
  if (!match) throw new Error(`color token ${name} not found in app/globals.css`)
  return match[1]!
}

describe('x-cyan-text contrast (WCAG AA)', () => {
  const token = readToken('--color-x-cyan-text')

  it.each([
    ['base-light (#F8FAFC)', '#F8FAFC'],
    ['white (#FFFFFF)', '#FFFFFF'],
  ])('clears ≥4.5:1 on %s', (_label, background) => {
    const ratio = contrastRatio(token, background)
    expect(ratio).toBeGreaterThanOrEqual(4.5)
  })

  it('the -text variant is meaningfully darker/safer than the raw accent, even though both clear AA now', () => {
    // #157 Phase 1: unlike the old cyan, the raw red accent ALSO clears AA on light
    // (documented below) — so the split is no longer strictly required for legibility.
    // It stays anyway (existing ~250 call sites use the two tokens for different
    // purposes — decorative vs. text) and this guards that the -text token keeps its
    // larger safety margin rather than drifting back to equal the raw accent.
    const accent = readToken('--color-x-cyan')
    const ratio = contrastRatio(token, '#FFFFFF')
    const accentRatio = contrastRatio(accent, '#FFFFFF')
    expect(ratio).toBeGreaterThan(accentRatio)
  })

  it('the raw accent x-cyan itself clears AA on light (documents the #157 red repaint — no longer the illegible-cyan case this token split originally guarded)', () => {
    const accent = readToken('--color-x-cyan')
    expect(contrastRatio(accent, '#F8FAFC')).toBeGreaterThanOrEqual(4.5)
  })
})

describe('x-blue hover-state contrast (WCAG AA) — #157 Phase 1', () => {
  // Header/MobileNav render white nav-link text over an x-blue hover fill — this must
  // clear AA same as any other text/background pairing, not just "looks blue enough".
  it('white text on x-blue clears ≥4.5:1', () => {
    const blue = readToken('--color-x-blue')
    expect(contrastRatio('#FFFFFF', blue)).toBeGreaterThanOrEqual(4.5)
  })
})
