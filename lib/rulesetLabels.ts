// lib/rulesetLabels.ts
// The ONE place Ruleset values become German UI copy — shared by the public view page,
// the PDF export, and RulesetForm, so all three surfaces can never drift apart.
import type { DeckFormat } from '@prisma/client'

export const DECK_FORMATS: DeckFormat[] = [
  'WBO_COUNTERDECK',
  'THREE_ON_THREE',
  'PICK_THREE_CHOOSE_ONE',
  'ONE_ON_ONE',
]

export const DECK_FORMAT_LABELS: Record<DeckFormat, string> = {
  WBO_COUNTERDECK: 'WBO Counter Deck',
  THREE_ON_THREE: '3on3',
  PICK_THREE_CHOOSE_ONE: 'Pick 3 – Choose 1',
  ONE_ON_ONE: '1on1',
}

export const RULESET_FIELD_LABELS = {
  title: 'Titel',
  description: 'Beschreibung',
  isPublic: 'Öffentlich',
  deckFormat: 'Deck-Format',
  targetPoints: 'Zielpunkte (Vorrunde)',
  finalsTargetPoints: 'Zielpunkte (Finale)',
  lockedDecks: 'Gesperrte Decks',
  allowForceSwitch: 'Force-Switch erlaubt',
  arenaTurnAllowed: 'Arena-Drehung erlaubt',
  outOfBounds2Pts: 'Out-of-Bounds = 2 Punkte',
  ownFinishPenalty: 'Own-Finish-Strafe',
  relaunchLimit: 'Relaunch-Limit',
  aerialContactRerun: 'Wiederholung bei Luftkontakt',
  externalDisturbanceRerun: 'Wiederholung bei äußeren Störungen',
} as const

// Short helper texts under the toggles, shared between form and view page.
export const RULESET_FIELD_HINTS = {
  lockedDecks: 'Decks dürfen während des Turniers nicht verändert werden.',
  allowForceSwitch: 'Spieler:innen dürfen zwischen den Builds eines Decks wechseln.',
  arenaTurnAllowed: 'Die Arena darf vor dem Start gedreht werden.',
  outOfBounds2Pts: 'Ein Out-of-Bounds zählt 2 Punkte statt 1.',
  ownFinishPenalty: 'Ein Own Finish zieht 1 Punkt ab und wird wiederholt.',
  aerialContactRerun: 'Berühren sich beide Beys in der Luft, wird der Durchgang wiederholt.',
  externalDisturbanceRerun: 'Bei äußeren Störungen (z. B. Objekt in der Arena) wird der Durchgang wiederholt.',
  isPublic: 'Öffentliche Regelwerke sind für alle sichtbar und in der Liste aufgeführt.',
} as const
