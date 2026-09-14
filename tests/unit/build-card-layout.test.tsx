// tests/unit/build-card-layout.test.tsx
// Live-Report ("Warum ist das nicht wie bei Beyblades?" / DevTools-Screenshot: Titel-<p> mit
// 0x20px Breite): WinRateBadge/Verfügbarkeits-Badge/TypeBadge standen als Geschwister des
// `min-w-0 flex-1`-Textblocks in derselben obersten Flex-Zeile. Unter Platzdruck (lange
// WinRateBadge-Beschriftung "Noch nicht genug Daten" + TypeBadge) schrumpfte NUR der Textblock
// auf 0px, weil `min-w-0` seine sonst geltende `min-width:auto`-Untergrenze aufhebt — der Titel
// war im DOM vorhanden (Quelltext zeigte ihn), aber unsichtbar. Fix: Badges in eine eigene Zeile
// UNTERHALB des Titels, innerhalb desselben Containers (wie BeybladeCard.tsx) — sie konkurrieren
// dann nicht mehr um horizontale Breite mit dem Titel. Dieser Test verankert genau das: Titel und
// Badges müssen im selben `min-w-0`-Container liegen, nicht als Zeilen-Geschwister.
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { BuildCard, type BuildCardData } from '@/components/beyblade/BuildCard'

function build(overrides: Partial<BuildCardData> = {}): BuildCardData {
  return {
    id: 'b1',
    type: 'ATTACK',
    blade: { id: 'p-blade', name: 'Spear Scorpio' },
    ratchet: { id: 'p-ratchet', name: '0-70' },
    bit: { id: 'p-bit', name: 'Zap' },
    name: 'Spear Scorpio 0-70Z',
    ...overrides,
  }
}

describe('BuildCard-Layout (Live-Report: Titel bei 0px Breite unsichtbar)', () => {
  it('Titel und Badges (WinRate/Typ) liegen im selben min-w-0-Container, nicht als Zeilen-Geschwister', () => {
    render(<BuildCard build={build()} />)
    const title = screen.getByText('Spear Scorpio 0-70Z')
    const typeBadge = screen.getByText('Angriff')
    // Gemeinsamer Vorfahre ist der min-w-0-Textblock selbst (title.parentElement) — nicht die
    // äußere Link-Zeile, in der Bild/Badges vorher um dieselbe Breite konkurrierten.
    const textContainer = title.parentElement
    expect(textContainer).toHaveClass('min-w-0')
    expect(textContainer).toContainElement(typeBadge)
  })

  it('Bild trägt shrink-0, damit es unter Platzdruck nicht mitschrumpft', () => {
    render(<BuildCard build={build()} />)
    const placeholder = screen.getByText('Spear Scorpio 0-70Z').closest('a')!.querySelector('[aria-hidden="true"]')
    // Kein imageId in den Testdaten → der graue Platzhalter-Div rendert statt <Image>.
    expect(placeholder).toHaveClass('shrink-0')
  })
})
