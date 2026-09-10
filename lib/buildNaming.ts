// lib/buildNaming.ts (Phase 20)
// Canonical Build naming — the user-confirmed WBO/retail grammar "<Blade> <Ratchet><Bit-short>":
// a space between the blade name and the ratchet, then the bit's short code appended directly
// (NO space, NO hyphen): Blade "Circle Ghost" + Ratchet "4-60" + Bit short "LR" → "Circle Ghost 4-60LR".
// Pure functions only (unit-tested in tests/unit/build-naming.test.ts) — creation call sites
// apply the name only when the creator provided no explicit official Set name.

/** The confirmed canonical grammar. `bit` is the bit's SHORT CODE (e.g. "LR"), not its full name. */
export function canonicalBuildName(blade: string, ratchet: string, bit: string): string {
  return `${blade} ${ratchet}${bit}`
}

// Bit short-code derivation: catalog Bit Parts carry their full name ("Rush", "Gear Flat",
// "Low Rush") and the Part model has no short-code column — the retail short code is the
// concatenated first letter of each name word, uppercased. Verified against prisma/seed.mjs's
// seeded Bits (single-word names Flat/Taper/Ball/Orb/Rush/Hex/Point → F/T/B/O/R/H/P — exactly
// the real retail codes) and against multi-word retail bits (Gear Flat → GF, Low Rush → LR).
export function bitShortCode(bitName: string): string {
  return bitName
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}

/** Convenience for creation call sites holding the three full part names: derives the bit's
 *  short code, then applies the canonical grammar. */
export function deriveBuildName(bladeName: string, ratchetName: string, bitName: string): string {
  return canonicalBuildName(bladeName, ratchetName, bitShortCode(bitName))
}
