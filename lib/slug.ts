// lib/slug.ts
// Pure slug generation for URL-safe, unique, deterministic resource slugs (Phase 2
// rulesets; later phases reuse this for clubs etc.). The string transform is deliberately
// free of any DB access so it stays unit-testable; callers inject the collision lookup
// as the `isTaken` callback (the route uses prisma, tests use an in-memory Set).
//
// Deterministic: the same title always slugifies to the same base, so "My Ruleset"
// created twice yields "my-ruleset" and "my-ruleset-2" — never a random suffix.

const UMLAUTS: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', Ä: 'Ae', Ö: 'Oe', Ü: 'Ue', ß: 'ss' }

const MAX_SLUG_LENGTH = 60

export function slugify(title: string): string {
  const slug = title
    .replace(/[äöüÄÖÜß]/g, (ch) => UMLAUTS[ch])
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip remaining combining diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, '')
  return slug || 'regelwerk'
}

// Returns `base` if free, otherwise `base-2`, `base-3`, … until a free slug is found.
export async function uniqueSlug(
  base: string,
  isTaken: (slug: string) => Promise<boolean>,
): Promise<string> {
  if (!(await isTaken(base))) return base
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`
    if (!(await isTaken(candidate))) return candidate
  }
}
