// lib/rulesetProse.ts (Phase 10 item 3)
// Toggle-to-prose template: turns each structured Ruleset field into a full explanatory
// paragraph instead of a bare badge/hint, modeled on the World Beyblade Organization's own
// rules-page depth (full sections explaining what a toggle means procedurally, not just
// naming it). Shared by the public rules page — a pure function so it can't drift from what
// actually renders, and so a later long-form Markdown body (Phase 8-dependent) can sit
// alongside this without replacing it.
// RC10 #72: each entry now also carries `deviates` (differs from the WoB base, lib/wobBase)
// so the UI can keep the prose as SECONDARY detail (behind "Erklärung anzeigen") while the
// primary rendering is the compact ✓/✗ checklist.
import type { Ruleset } from '@prisma/client'
import { WOB_BASE } from '@/lib/wobBase'

type ProseField =
  | 'lockedDecks'
  | 'allowForceSwitch'
  | 'arenaTurnAllowed'
  | 'outOfBounds2Pts'
  | 'ownFinishPenalty'
  | 'aerialContactRerun'
  | 'externalDisturbanceRerun'

export interface RulesetToggleProse {
  label: string
  value: boolean
  // RC10 #72: true when this option deviates from the WoB base ruleset (lib/wobBase).
  deviates: boolean
  paragraph: string
}

function relaunchClause(relaunchLimit: number): string {
  return relaunchLimit === 1
    ? 'ein Neustart ist erlaubt'
    : `bis zu ${relaunchLimit} Neustarts sind pro Match erlaubt`
}

export function buildRulesetProse(ruleset: Pick<Ruleset, ProseField | 'relaunchLimit'>): RulesetToggleProse[] {
  const prose: (Omit<RulesetToggleProse, 'deviates'> & { key: ProseField })[] = [
    {
      key: 'lockedDecks',
      label: 'Gesperrte Decks',
      value: ruleset.lockedDecks,
      paragraph: ruleset.lockedDecks
        ? 'Gesperrte Decks aktiv: Sobald das Turnier durch die Turnierleitung gestartet wurde, dürfen die drei registrierten Builds eines Decks nicht mehr verändert werden — kein Teiletausch, kein Umbau, keine Neuzusammenstellung bis zum Ende des Turniers. Die Zusammensetzung wird beim Deck-Check festgehalten.'
        : 'Gesperrte Decks inaktiv: Teilnehmer:innen dürfen ihr Deck auch nach Turnierstart zwischen Matches umbauen — etwa um auf die Builds der Gegner:innen zu reagieren. Der Deck-Check gilt dann nur für das jeweils aktuelle Match, nicht für das ganze Turnier.',
    },
    {
      key: 'allowForceSwitch',
      label: 'Force-Switch erlaubt',
      value: ruleset.allowForceSwitch,
      paragraph: ruleset.allowForceSwitch
        ? 'Force-Switch erlaubt: Innerhalb eines Matches dürfen Spieler:innen vor jedem Durchgang frei zwischen den drei Builds ihres Decks wechseln, solange kein Build mehrfach hintereinander im selben Match gesperrt ist. Das eröffnet taktische Anpassungen mitten im Match.'
        : 'Force-Switch nicht erlaubt: Das zu Matchbeginn gewählte Build bleibt für die gesamte Dauer des Matches fest — ein Wechsel ist erst im nächsten Match möglich. Das erhöht das Gewicht der Build-Wahl vor jedem einzelnen Match.',
    },
    {
      key: 'arenaTurnAllowed',
      label: 'Arena-Drehung erlaubt',
      value: ruleset.arenaTurnAllowed,
      paragraph: ruleset.arenaTurnAllowed
        ? 'Arena-Drehung erlaubt: Vor Beginn eines Durchgangs darf ein:e Judge oder Spieler:in die Arena drehen, etwa um Verschleiß gleichmäßiger zu verteilen oder Lichtverhältnisse auszugleichen. Beide Spieler:innen müssen der neuen Ausrichtung zustimmen, bevor gestartet wird.'
        : 'Arena-Drehung nicht erlaubt: Die Arena bleibt für das gesamte Match in der ursprünglichen Ausrichtung, wie sie zu Beginn des Matches aufgestellt wurde.',
    },
    {
      key: 'outOfBounds2Pts',
      label: 'Out-of-Bounds = 2 Punkte',
      value: ruleset.outOfBounds2Pts,
      paragraph: ruleset.outOfBounds2Pts
        ? 'Out-of-Bounds zählt 2 Punkte: Verlässt ein Bey während eines Durchgangs die Arena (Ring-Out), erhält der Gegner 2 Punkte statt der sonst üblichen 1 — Out-of-Bounds wird damit wie ein Over Finish gewertet.'
        : 'Out-of-Bounds zählt 1 Punkt: Ein Ring-Out wird wie ein einfaches Spin Finish gewertet und bringt dem Gegner den regulären 1 Punkt.',
    },
    {
      key: 'ownFinishPenalty',
      label: 'Own-Finish-Strafe',
      value: ruleset.ownFinishPenalty,
      paragraph: ruleset.ownFinishPenalty
        ? `Own-Finish-Strafe aktiv: Schießt sich ein Bey ohne Gegnerkontakt selbst aus der Arena, aus der Bewegung heraus oder bleibt anderweitig durch eigenes Verschulden ohne Fremdeinwirkung liegen, erhält der Gegner 1 Strafpunkt, und der Durchgang wird wiederholt (${relaunchClause(ruleset.relaunchLimit)}).`
        : 'Own-Finish-Strafe inaktiv: Ein Own-Finish wird nicht gesondert bestraft — der Durchgang wird lediglich wiederholt, ohne dass dem Gegner ein zusätzlicher Punkt gutgeschrieben wird.',
    },
    {
      key: 'aerialContactRerun',
      label: 'Wiederholung bei Luftkontakt',
      value: ruleset.aerialContactRerun,
      paragraph: ruleset.aerialContactRerun
        ? 'Wiederholung bei Luftkontakt aktiv: Berühren sich beide Beys während des Starts in der Luft (bevor beide die Arena erreicht haben), wird der Durchgang ohne Punktevergabe wiederholt — keine Seite wird für diesen Zufall bestraft.'
        : 'Wiederholung bei Luftkontakt inaktiv: Ein Luftkontakt beim Start wird wie ein regulärer Durchgang gewertet; das Ergebnis zählt, auch wenn sich die Beys vor der Arena berührt haben.',
    },
    {
      key: 'externalDisturbanceRerun',
      label: 'Wiederholung bei äußeren Störungen',
      value: ruleset.externalDisturbanceRerun,
      paragraph: ruleset.externalDisturbanceRerun
        ? 'Wiederholung bei äußeren Störungen aktiv: Wird ein Durchgang durch ein Ereignis außerhalb der Kontrolle beider Spieler:innen gestört — etwa ein Fremdobjekt, das in die Arena gerät, oder ein technisches Problem am Launcher — wird der Durchgang auf Ansage der Judge/des Judges wiederholt, ohne dass Punkte vergeben werden.'
        : 'Wiederholung bei äußeren Störungen inaktiv: Ein durch äußere Umstände gestörter Durchgang zählt trotzdem regulär; eine Wiederholung liegt nicht im automatischen Ermessen der Judge.',
    },
  ]
  // #72: flag every option that deviates from the WoB base — the UI renders this as the
  // compact ✓/✗ checklist with deviation marks, so the deviation info must not drift.
  return prose.map(({ key, ...entry }) => ({
    ...entry,
    deviates: ruleset[key] !== WOB_BASE[key],
  }))
}
