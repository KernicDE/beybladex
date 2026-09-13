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

// RC16 (#106) — einheitliche Bit-Anzeige "Kurzcode (Vollname)", z. B. "F (Flat)": der volle
// Name bleibt der gespeicherte Part.name (sonst bräche bitShortCode/deriveBuildName), nur die
// Darstellung setzt Kurzcode und Vollname zusammen.
export function formatBitDisplay(bitName: string): string {
  const name = bitName.trim().split(/\s+/).join(' ')
  return `${bitShortCode(name)} (${name})`
}

// RC16 (#122) — variable Bauformen. Der abgeleitete Name trägt immer die Blade-Assembly voran
// (Standard/Ratchet-Integrated: das BLADE-Teil; Custom Line: der Lock Chip — das einzelne
// Namensträger-Teil des CX-Stacks), dann optional das Ratchet, direkt gefolgt vom Bit-Shortcode.
// Bekannte Grenze: der Retail-Bladecode von CX-Sets (z. B. „IS" in „Hurricane Enlil IS 7-55T")
// ist aus den Teilnamen NICHT ableitbar — offizielle CX-Creates müssen den kuratierten
// Retail-Namen mitschicken (der Official-Pfad nutzt die Verbatim-Name ohnehin vorrangig).
export interface BuildNameParts {
  /** BLADE-Teil-Name (Standard / Ratchet-Integrated); null bei Custom Line. */
  bladeName: string | null
  /** Lock-Chip-Name (Custom Line); null bei Standard-Bauformen. */
  lockChipName?: string | null
  /** RATCHET-Teil-Name; null wenn das Blade das Ratchet integriert. */
  ratchetName: string | null
  /** BIT-Vollname (Shortcode wird abgeleitet). */
  bitName: string
}

export function deriveBuildName(parts: BuildNameParts): string {
  const head = parts.bladeName ?? parts.lockChipName ?? null
  if (head === null) throw new Error('build_name_no_blade_assembly')
  const bit = bitShortCode(parts.bitName)
  // Standard/CX: "<Head> <Ratchet><Bit-short>" (kein Leerzeichen vor dem Bit-Shortcode).
  // Ratchet-Integrated: "<Head> <Bit-short>" — das Ratchet-Teil existiert nicht.
  return parts.ratchetName !== null ? `${head} ${parts.ratchetName}${bit}` : `${head} ${bit}`
}

/** Convenience für Creation-Call-Sites mit der von verifyAssemblyParts verifizierten Teil-Menge:
 *  löst die Slot-Ids je nach Bauform auf (null-Slot → null-Name) und leitet daraus den
 *  kanonischen Namen. Für Build UND Beyblade nutzbar — beide tragen dieselben Slot-Felder. */
export function deriveBuildNameFromParts(
  parts: Map<string, { name: string }>,
  input: { bladeId: string | null; lockChipId: string | null; ratchetId: string | null; bitId: string },
): string {
  return deriveBuildName({
    bladeName: input.bladeId !== null ? parts.get(input.bladeId)!.name : null,
    lockChipName: input.lockChipId !== null ? parts.get(input.lockChipId)!.name : null,
    ratchetName: input.ratchetId !== null ? parts.get(input.ratchetId)!.name : null,
    bitName: parts.get(input.bitId)!.name,
  })
}
