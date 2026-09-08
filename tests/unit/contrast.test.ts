// tests/unit/contrast.test.ts
// PERMANENT regression guard (Task 13): the x-cyan-text token must keep clearing
// WCAG AA (≥4.5:1) on the light backgrounds it renders on. The literal X-Cyan
// #00F0FF computes to ~1.5:1 there and is illegible as text — if this token is ever
// "fixed" back toward the accent value, this test fails. Real contrast math, not a
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

  it('the raw accent x-cyan does NOT clear AA on light (documents why the token exists)', () => {
    // Guard against someone "simplifying" the two tokens back into one: the literal
    // accent must remain the illegible-on-light value this rule is about.
    const accent = readToken('--color-x-cyan')
    expect(contrastRatio(accent, '#F8FAFC')).toBeLessThan(4.5)
  })
})
