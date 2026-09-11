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
