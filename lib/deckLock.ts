// lib/deckLock.ts (Issue #181 — "Decklock")
// Turniere können Decks vorab anfordern; Teilnehmer:innen dürfen sich aber früher anmelden, als
// die Decks gelockt werden müssen. Der Veranstalter gibt optional eine eigene Sperrfrist vor
// (Tournament.deckLockAt); ist keine gesetzt, gilt der Event-Start. Als eigene, pure Funktion
// extrahiert (statt inline an jeder Verwendungsstelle dupliziert), damit die Kernregel ohne
// DB/Request-Kontext testbar ist und garantiert überall gleich ausgewertet wird
// (join/route.ts's Deck-Wahl/-Wechsel-Gate UND der Sweep-Cron müssen exakt dieselbe Uhrzeit
// sehen, sonst könnte ein Teilnehmer knapp nach dem einen, aber vor dem anderen Zeitpunkt in
// eine Lücke fallen).
export function resolveDeckLockAt(deckLockAt: Date | null, startDate: Date): Date {
  return deckLockAt ?? startDate
}
