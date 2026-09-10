// lib/displayName.ts
// Phase 19: User.displayName stays free-form Unicode/casing, but two users must never hold
// display names that read as the same name ("MaxMustermann" vs "maxmustermann", fullwidth or
// otherwise compatibility-folded look-alikes). The collision-checked form is this normalized
// column, stored as User.displayNameNormalized (@unique) alongside every displayName write.
// NFKC folds Unicode compatibility/look-alike forms (fullwidth, ligatures, circled letters),
// not just casing. A null displayName produces a null normalized value — Postgres unique
// indexes permit multiple NULLs, so users who never set a display name never collide.
export function normalizeDisplayName(value: string | null): string | null {
  if (value === null) return null
  return value.trim().toLowerCase().normalize('NFKC')
}
