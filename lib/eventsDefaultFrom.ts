// lib/eventsDefaultFrom.ts
// Live-Report ("wann verschwinden Turniere aus der Liste? — nie"): /events hatte standardmäßig
// keinen Datumsfilter, vergangene Turniere blieben für immer gelistet (aufsteigend sortiert
// sogar dauerhaft an der Spitze von Seite 1). Neuer Standard: ohne explizites "Von" gilt "heute
// und später"; ein explizit gesetztes (auch vergangenes) "Von" wird weiterhin respektiert — "nur
// wenn explizit ein Filter passt" darf Vergangenes wieder zeigen. Als eigene, pure Funktion
// extrahiert (statt inline in app/events/page.tsx), damit die Kernregel ohne DB/Request-Kontext
// testbar ist.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Der tatsächlich anzuwendende "Von"-Wert (YYYY-MM-DD): der explizite Query-Param, wenn gültig,
 * sonst `todayIso` (vom Call-Site übergeben statt intern `new Date()` — deterministisch testbar,
 * kein Zeitzonen-Rätselraten in den Tests).
 */
export function resolveEffectiveFrom(from: string | undefined, todayIso: string): string {
  return from && DATE_RE.test(from) ? from : todayIso
}
