// lib/rulesetPdf.ts
// Server-side PDF export for a Ruleset via @react-pdf/renderer (npm-bundled, never a
// client-side/CDN PDF library — Global Constraints zero-CDN rule). renderToBuffer runs in
// the Node runtime of /rules/[slug]/pdf/route.ts; the default Helvetica font is bundled
// with react-pdf, so no external font request is ever made.
import { createElement } from 'react'
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from '@react-pdf/renderer'
import type { Ruleset } from '@prisma/client'
import { DECK_FORMAT_LABELS, RULESET_FIELD_HINTS } from '@/lib/rulesetLabels'

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 11, fontFamily: 'Helvetica', color: '#111827' },
  title: { fontSize: 22, marginBottom: 4 },
  description: { fontSize: 11, color: '#4b5563', marginBottom: 16 },
  sectionTitle: { fontSize: 14, marginTop: 16, marginBottom: 6, fontFamily: 'Helvetica-Bold' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 0.5, borderBottomColor: '#e5e7eb' },
  label: { flex: 1, paddingRight: 8 },
  hint: { fontSize: 8, color: '#6b7280' },
  value: { fontFamily: 'Helvetica-Bold' },
  footer: { marginTop: 24, fontSize: 8, color: '#9ca3af' },
})

function boolText(value: boolean) {
  return value ? 'Ja' : 'Nein'
}

export async function buildRulesetPdf(ruleset: Ruleset, ownerUsername: string): Promise<Buffer> {
  const doc = createElement(
    Document,
    { title: ruleset.title, author: ownerUsername },
    createElement(
      Page,
      { size: 'A4', style: styles.page },
      createElement(Text, { style: styles.title }, ruleset.title),
      ruleset.description ? createElement(Text, { style: styles.description }, ruleset.description) : null,
      createElement(
        View,
        null,
        createElement(Text, { style: styles.sectionTitle }, 'Grundeinstellungen'),
        createElement(View, { style: styles.row },
          createElement(Text, { style: styles.label }, 'Deck-Format'),
          createElement(Text, { style: styles.value }, DECK_FORMAT_LABELS[ruleset.deckFormat])),
        createElement(View, { style: styles.row },
          createElement(Text, { style: styles.label }, 'Zielpunkte (Vorrunde)'),
          createElement(Text, { style: styles.value }, String(ruleset.targetPoints))),
        createElement(View, { style: styles.row },
          createElement(Text, { style: styles.label }, 'Zielpunkte (Finale)'),
          createElement(Text, { style: styles.value }, String(ruleset.finalsTargetPoints))),
        createElement(View, { style: styles.row },
          createElement(Text, { style: styles.label }, 'Relaunch-Limit'),
          createElement(Text, { style: styles.value }, String(ruleset.relaunchLimit))),
      ),
      createElement(
        View,
        null,
        createElement(Text, { style: styles.sectionTitle }, 'Sonderregeln'),
        ...(
          [
            ['Gesperrte Decks', boolText(ruleset.lockedDecks), RULESET_FIELD_HINTS.lockedDecks],
            ['Force-Switch erlaubt', boolText(ruleset.allowForceSwitch), RULESET_FIELD_HINTS.allowForceSwitch],
            ['Arena-Drehung erlaubt', boolText(ruleset.arenaTurnAllowed), RULESET_FIELD_HINTS.arenaTurnAllowed],
            ['Out-of-Bounds = 2 Punkte', boolText(ruleset.outOfBounds2Pts), RULESET_FIELD_HINTS.outOfBounds2Pts],
            ['Own-Finish-Strafe', boolText(ruleset.ownFinishPenalty), RULESET_FIELD_HINTS.ownFinishPenalty],
            ['Wiederholung bei Luftkontakt', boolText(ruleset.aerialContactRerun), RULESET_FIELD_HINTS.aerialContactRerun],
            ['Wiederholung bei äußeren Störungen', boolText(ruleset.externalDisturbanceRerun), RULESET_FIELD_HINTS.externalDisturbanceRerun],
          ] as const
        ).map(([label, value, hint]) =>
          createElement(View, { key: label, style: styles.row },
            createElement(View, { style: styles.label },
              createElement(Text, null, label),
              createElement(Text, { style: styles.hint }, hint)),
            createElement(Text, { style: styles.value }, value)),
        ),
      ),
      createElement(Text, { style: styles.footer }, `Erstellt von ${ownerUsername} auf BeybladeX.de`),
    ),
  )

  return renderToBuffer(doc)
}
