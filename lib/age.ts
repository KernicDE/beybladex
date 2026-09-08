// lib/age.ts
// Single source of truth for the age gate (Task 5) and every place that re-runs it
// (registration, Task 12's profile rectification). Germany's GDPR Art. 8 threshold — the
// highest in DACH; using the strictest applicable threshold for all three countries is the
// only choice that's correct everywhere without per-country legal branching.
export const MINOR_CONSENT_AGE_THRESHOLD = 16

export function calculateAge(birthDate: Date, now = new Date()): number {
  let age = now.getFullYear() - birthDate.getFullYear()
  const monthDiff = now.getMonth() - birthDate.getMonth()
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birthDate.getDate())) age--
  return age
}
