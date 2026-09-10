// lib/dachRegions.ts (Phase 9)
// Canonical list of the first-level administrative regions of the three DACH countries:
//   DE — 16 Bundesländer
//   AT —  9 Bundesländer
//   CH — 26 Kantone
//
// This is the single source of truth for region codes/names across the app (Phase 9 uses
// it to canonicalize Nominatim's region strings; a later phase building regional
// feeds/filters depends on this exact exported shape). Keep it data-only, dependency-free,
// and importable from both server and client code — do NOT pull in lib/geo.ts or Prisma
// types here.
//
// Spelling notes:
// - `name` is the canonical German display name ("Bayern", "Wien", "Zürich").
// - `code` is the official ISO-3166-2 subdivision code without the country prefix
//   (DE-BW → "BW", AT-W → "W", CH-ZH → "ZH") — stable identifiers for URLs/filters.
// - `aliases` are additional spellings OSM/Nominatim is known to emit for the region,
//   stored lowercase; matching is case-insensitive and whitespace-normalized.

export type DachCountry = 'DE' | 'AT' | 'CH'

export interface DachRegion {
  code: string
  name: string
  aliases: string[]
}

const DE: DachRegion[] = [
  { code: 'BW', name: 'Baden-Württemberg', aliases: [] },
  { code: 'BY', name: 'Bayern', aliases: ['freistaat bayern'] },
  { code: 'BE', name: 'Berlin', aliases: [] },
  { code: 'BB', name: 'Brandenburg', aliases: [] },
  { code: 'HB', name: 'Bremen', aliases: ['freie hansestadt bremen'] },
  { code: 'HH', name: 'Hamburg', aliases: ['freie und hansestadt hamburg'] },
  { code: 'HE', name: 'Hessen', aliases: [] },
  { code: 'MV', name: 'Mecklenburg-Vorpommern', aliases: ['mecklenburg vorpommern'] },
  { code: 'NI', name: 'Niedersachsen', aliases: [] },
  { code: 'NW', name: 'Nordrhein-Westfalen', aliases: ['nordrhein westfalen'] },
  { code: 'RP', name: 'Rheinland-Pfalz', aliases: ['rheinland pfalz'] },
  { code: 'SL', name: 'Saarland', aliases: [] },
  { code: 'SN', name: 'Sachsen', aliases: ['freistaat sachsen'] },
  { code: 'ST', name: 'Sachsen-Anhalt', aliases: ['sachsen anhalt'] },
  { code: 'SH', name: 'Schleswig-Holstein', aliases: ['schleswig holstein'] },
  { code: 'TH', name: 'Thüringen', aliases: ['freistaat thüringen'] },
]

const AT: DachRegion[] = [
  { code: 'B', name: 'Burgenland', aliases: [] },
  { code: 'K', name: 'Kärnten', aliases: ['kaernten'] },
  { code: 'N', name: 'Niederösterreich', aliases: ['niederoesterreich'] },
  { code: 'O', name: 'Oberösterreich', aliases: ['oberoesterreich'] },
  { code: 'S', name: 'Salzburg', aliases: [] },
  { code: 'St', name: 'Steiermark', aliases: [] },
  { code: 'T', name: 'Tirol', aliases: ['tyrol'] },
  { code: 'V', name: 'Vorarlberg', aliases: [] },
  { code: 'W', name: 'Wien', aliases: ['vienna'] },
]

const CH: DachRegion[] = [
  { code: 'ZH', name: 'Zürich', aliases: ['zuerich'] },
  { code: 'BE', name: 'Bern', aliases: ['berne'] },
  { code: 'LU', name: 'Luzern', aliases: ['lucerne'] },
  { code: 'UR', name: 'Uri', aliases: [] },
  { code: 'SZ', name: 'Schwyz', aliases: [] },
  { code: 'OW', name: 'Obwalden', aliases: [] },
  { code: 'NW', name: 'Nidwalden', aliases: [] },
  { code: 'GL', name: 'Glarus', aliases: [] },
  { code: 'ZG', name: 'Zug', aliases: [] },
  { code: 'FR', name: 'Freiburg', aliases: ['fribourg', 'freiburg im üechtland', 'freiburg im ueachtland', 'freiburg im ueichtland'] },
  { code: 'SO', name: 'Solothurn', aliases: [] },
  { code: 'BS', name: 'Basel-Stadt', aliases: ['basel stadt', 'basel-city'] },
  { code: 'BL', name: 'Basel-Landschaft', aliases: ['basel landschaft', 'basel-country'] },
  { code: 'SH', name: 'Schaffhausen', aliases: ['schaffhouse'] },
  { code: 'AR', name: 'Appenzell Ausserrhoden', aliases: ['appenzell a. rh.', 'ausserrhoden'] },
  { code: 'AI', name: 'Appenzell Innerrhoden', aliases: ['appenzell i. rh.', 'innerrhoden'] },
  { code: 'SG', name: 'St. Gallen', aliases: ['st.gallen', 'sankt gallen', 'st gallen'] },
  { code: 'GR', name: 'Graubünden', aliases: ['graubuenden', 'grischun', 'grigioni', 'grisons'] },
  { code: 'AG', name: 'Aargau', aliases: [] },
  { code: 'TG', name: 'Thurgau', aliases: [] },
  { code: 'TI', name: 'Tessin', aliases: ['ticino'] },
  { code: 'VD', name: 'Waadt', aliases: ['vaud'] },
  { code: 'VS', name: 'Wallis', aliases: ['valais'] },
  { code: 'NE', name: 'Neuenburg', aliases: ['neuchâtel', 'neuchatel'] },
  { code: 'GE', name: 'Genf', aliases: ['genève', 'geneve', 'geneva'] },
  { code: 'JU', name: 'Jura', aliases: [] },
]

export const DACH_REGIONS: Record<DachCountry, readonly DachRegion[]> = { DE, AT, CH }

/** Lowercase + whitespace-normalized form used for all region-name matching. */
export function normalizeRegionName(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Resolve a raw region string (as Nominatim/OSM tags it) to its canonical DachRegion.
 * Matches exact names and registered aliases, plus the Swiss "Kanton <name>" prefix form.
 * Returns null when nothing matches — callers then fall back to the raw string (it stays
 * an editable free-text field) rather than inventing a name.
 */
export function matchDachRegion(country: DachCountry, raw: string | null | undefined): DachRegion | null {
  const needle = normalizeRegionName(raw ?? '')
  if (!needle) return null
  for (const region of DACH_REGIONS[country]) {
    if (normalizeRegionName(region.name) === needle) return region
    if (region.aliases.some((alias) => normalizeRegionName(alias) === needle)) return region
    if (country === 'CH' && needle === `kanton ${normalizeRegionName(region.name)}`) return region
  }
  return null
}

/** Canonical display name for a raw region string, or null when it matches nothing known. */
export function canonicalRegionName(country: DachCountry, raw: string | null | undefined): string | null {
  return matchDachRegion(country, raw)?.name ?? null
}
