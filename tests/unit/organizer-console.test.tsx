// tests/unit/organizer-console.test.tsx (RC11 #82)
// The organizer console is split into separately headed Cards instead of one monolithic
// block. These tests pin the section structure (every functional area has its own heading)
// and that the core actions survive the layout-only refactor.
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { OrganizerConsole, type ConsoleStage } from '@/components/tournament/OrganizerConsole'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

const BASE = {
  tournamentId: 't-1',
  participants: [],
  teamMode: false,
  teamEntries: [],
  stages: [] as ConsoleStage[],
  judges: [],
  completedAt: null,
  startedAt: null,
  tournamentJudges: [],
  entryFeeCent: 0,
  headerImageId: null,
}

const STAGE: ConsoleStage = {
  id: 's1',
  order: 1,
  name: 'Vorrunde',
  format: 'SINGLE_ELIMINATION',
  status: 'PENDING',
  swissRounds: null,
  swissRoundsDone: 0,
  qualifyCount: null,
  matches: [
    {
      id: 'm1',
      stageId: 's1',
      round: 1,
      label: 'R1 M1',
      player1: 'Ana',
      player2: 'Ben',
      status: 'OPEN',
      judgeId: null,
    },
  ],
  teamMatches: [],
  standings: [],
}

const STAGE_EMPTY: ConsoleStage = { ...STAGE, id: 's0', name: 'Vorrunde', matches: [] }
const STAGE_FINAL: ConsoleStage = { ...STAGE, id: 's1', order: 2, name: 'Finale' }

describe('OrganizerConsole — section structure (RC11 #82)', () => {
  it('renders the console title and its core actions', () => {
    render(<OrganizerConsole {...BASE} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Organisatoren-Konsole' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Turnier bearbeiten' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turnier starten' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turnier absagen' })).toBeInTheDocument()
    // No stages yet → stage-create form + the empty-stage hint live in the first card.
    expect(screen.getByRole('heading', { name: 'Stage hinzufügen' })).toBeInTheDocument()
    expect(screen.getByText(/Noch keine Stage\./)).toBeInTheDocument()
  })

  it('renders a separate headed Stages & Matches card with its per-stage actions', () => {
    render(<OrganizerConsole {...BASE} stages={[STAGE_EMPTY, STAGE_FINAL]} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Stages & Matches' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: /1\. Vorrunde/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Bracket generieren' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /Judge zuweisen — Finale/ })).toBeInTheDocument()
  })

  it('renders payment and staff sections as their own headed cards', () => {
    render(
      <OrganizerConsole
        {...BASE}
        entryFeeCent={500}
        judges={[{ id: 'j1', name: 'Judge Jana' }]}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Zahlungsverfolgung' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Turnier-Staff (Check-in, Arena, Zahlung)' })).toBeInTheDocument()
  })

  it('renders the completion actions in their own card once a bracket exists', () => {
    render(<OrganizerConsole {...BASE} stages={[STAGE_FINAL]} />)
    expect(screen.getByRole('heading', { level: 2, name: 'Turnier abschließen' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Nicht erschienen (No-Show)' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Turnier abschließen' })).toBeInTheDocument()
  })

  it('hides the completion card once the tournament is completed', () => {
    render(<OrganizerConsole {...BASE} stages={[STAGE]} completedAt={new Date().toISOString()} />)
    expect(screen.queryByRole('heading', { level: 2, name: 'Turnier abschließen' })).not.toBeInTheDocument()
    expect(screen.getByText('Turnier abgeschlossen')).toBeInTheDocument()
  })
})
