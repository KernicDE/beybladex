// lib/errorCopy.ts
// The ONE place API error codes become German user-facing copy. Every phase's form
// surfaces errorCopy[code] (or errorMessage(code) for the fallback) instead of raw
// codes or ad hoc translations. Codes listed here are the ones actually returned by
// the route handlers under app/api/ (grep for `error: '<code>'` there) — when a new
// route adds a code, add its German copy here in the same task.

const COPY: Record<string, string> = {
  // auth & session
  unauthorized: 'Du musst angemeldet sein, um das zu tun.',
  invalid_credentials: 'Benutzername oder Passwort ist falsch.',
  invalid_password: 'Das Passwort ist ungültig (mindestens 8 Zeichen).',
  password_not_set: 'Für dieses Konto ist kein Passwort hinterlegt.',
  confirmation_required: 'Bitte bestätige die Aktion mit deinem Passwort.',
  password_required: 'Bitte gib dein Passwort ein.',
  // registration
  invalid_username:
    'Der Benutzername ist ungültig (3–20 Zeichen: Kleinbuchstaben, Zahlen, Unterstrich).',
  username_taken: 'Dieser Benutzername ist bereits vergeben.',
  privacy_policy_not_accepted:
    'Bitte lies und akzeptiere die Datenschutzerklärung.',
  invalid_birth_date: 'Das Geburtsdatum ist ungültig.',
  parental_consent_email_required:
    'Für Nutzer:innen unter 16 Jahren ist die E-Mail-Adresse der Eltern erforderlich.',
  registration_failed: 'Die Registrierung ist fehlgeschlagen. Bitte versuche es erneut.',
  // rate limiting / generic request problems
  rate_limited: 'Zu viele Anfragen. Bitte warte einen Moment und versuche es erneut.',
  invalid_json: 'Ungültige Anfrage (JSON fehlerhaft).',
  invalid_body: 'Ungültige Anfragedaten.',
  missing_username: 'Bitte gib einen Benutzernamen an.',
  no_fields: 'Es wurden keine Felder zum Aktualisieren angegeben.',
  not_found: 'Nicht gefunden.',
  forbidden: 'Keine Berechtigung für diese Aktion.',
  // TOTP / 2FA
  invalid_token: 'Der eingegebene Code ist ungültig.',
  setup_expired: 'Die 2FA-Einrichtung ist abgelaufen. Bitte starte sie erneut.',
  totp_not_enabled: '2FA ist für dieses Konto nicht aktiviert.',
  // WebAuthn / passkeys
  challenge_expired_or_used:
    'Die Anfrage ist abgelaufen oder wurde bereits verwendet. Bitte versuche es erneut.',
  verification_failed: 'Die Verifizierung ist fehlgeschlagen. Bitte versuche es erneut.',
  challenge_user_mismatch: 'Der Passkey passt nicht zum angemeldeten Konto.',
  // profile
  invalid_country: 'Das angegebene Land ist ungültig.',
  // parental consent
  invalid_or_expired_token:
    'Dieser Einwilligungslink ist ungültig oder abgelaufen.',
}

// German copy for a known code; falls back to a generic message (never the raw code).
export function errorMessage(code: string): string {
  return COPY[code] ?? 'Ein unerwarteter Fehler ist aufgetreten. Bitte versuche es erneut.'
}

// The raw map for direct lookup / tests. Prefer errorMessage() at call sites.
export const errorCopy: Readonly<Record<string, string>> = COPY
