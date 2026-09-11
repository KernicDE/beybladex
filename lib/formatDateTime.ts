// lib/formatDateTime.ts (hotfix #98)
// The ONE date/time formatter for public event surfaces. The explicit `timeZone` is the point:
// without it, `toLocaleString` resolves the zone from the HOST (the container runs UTC — no TZ
// is set in the Dockerfile), so rendered times shifted with the server environment and could
// diverge from anything re-rendered with the browser's zone. Pinning Europe/Berlin (the app's
// audience: DACH) makes the output identical on every host.
export function formatDateTime(date: Date): string {
  return date.toLocaleString('de-DE', {
    timeZone: 'Europe/Berlin',
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// --- RC11 additions (#80 event list, #81 event detail) -------------------------------------
// All helpers below pin Europe/Berlin exactly like formatDateTime — the host's zone must never
// leak into rendered output (see the header comment).

const DATE_DAY_OPTS: Intl.DateTimeFormatOptions = {
  timeZone: 'Europe/Berlin',
  weekday: 'long',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
}

const TIME_OPTS: Intl.DateTimeFormatOptions = {
  timeZone: 'Europe/Berlin',
  hour: '2-digit',
  minute: '2-digit',
}

/** `Freitag, 11.09.2026` — ausgeschriebener Wochentag + TT.MM.JJJJ (#80). */
export function formatDateDay(date: Date): string {
  return date.toLocaleDateString('de-DE', DATE_DAY_OPTS)
}

/** `10:30` — Uhrzeit (HH:MM, Berlin) ohne "Uhr"-Suffix. */
export function formatTimeHM(date: Date): string {
  return date.toLocaleTimeString('de-DE', TIME_OPTS)
}
