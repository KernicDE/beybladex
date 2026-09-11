// tests/unit/ruleset-toggle-checklist.test.tsx (RC10 #72)
// The ruleset detail's primary rendering is a compact ✓/✗ checklist, not prose:
// one row per boolean option with an explicit an/aus state, a WoB badge per row
// (green "WoB-Standard" vs. neutral "Abweichung von WoB"), and the full explanatory
// paragraph preserved as secondary <details> content.
import { render, screen, within } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { RulesetToggleChecklist } from '@/components/rules/RulesetToggleChecklist'
import type { RulesetToggleProse } from '@/lib/rulesetProse'

function item(partial: Partial<RulesetToggleProse> & Pick<RulesetToggleProse, 'label'>): RulesetToggleProse {
  return { value: true, deviates: false, paragraph: `${partial.label} — ausführliche Erklärung.`, ...partial }
}

const ITEMS: RulesetToggleProse[] = [
  item({ label: 'Gesperrte Decks' }),
  item({ label: 'Force-Switch erlaubt', value: false, deviates: true }),
]

describe('RulesetToggleChecklist (#72)', () => {
  it('renders one row per option with an explicit on/off state', () => {
    render(<RulesetToggleChecklist items={ITEMS} />)
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('Aktiv:', { exact: false })).toBeInTheDocument()
    expect(within(rows[1]).getByText('Inaktiv:', { exact: false })).toBeInTheDocument()
    expect(within(rows[0]).getByText('Gesperrte Decks')).toBeInTheDocument()
    expect(within(rows[1]).getByText('Force-Switch erlaubt')).toBeInTheDocument()
  })

  it('marks deviations from the WoB base and WoB-standard options', () => {
    render(<RulesetToggleChecklist items={ITEMS} />)
    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0]).getByText('WoB-Standard')).toBeInTheDocument()
    expect(within(rows[0]).queryByText('Abweichung von WoB')).not.toBeInTheDocument()
    expect(within(rows[1]).getByText('Abweichung von WoB')).toBeInTheDocument()
    expect(within(rows[1]).queryByText('WoB-Standard')).not.toBeInTheDocument()
  })

  it('keeps the full explanation available as secondary details content', () => {
    render(<RulesetToggleChecklist items={ITEMS} />)
    // The prose paragraph is NOT rendered as always-visible text…
    const row = screen.getAllByRole('listitem')[0]
    expect(within(row).getByText('Gesperrte Decks — ausführliche Erklärung.')).toBeInTheDocument()
    expect(within(row).getByText('Gesperrte Decks — ausführliche Erklärung.').closest('details')).not.toBeNull()
    // …but the toggle label is directly visible.
    expect(within(row).getByText('Gesperrte Decks').closest('details')).toBeNull()
  })
})
