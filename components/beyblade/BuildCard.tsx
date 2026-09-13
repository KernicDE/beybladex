// components/beyblade/BuildCard.tsx
// Build summary card — used on /builds and wherever a build row renders (deck builder
// picker results). Part/Set images are MediaAssets served by the generic /api/media/[id]
// route (Phase 11's pipeline) and go through next/image with explicit sizing
// ([REVIEW-FIX: performance P12] — never an unoptimized <img> for catalog images).
//
// RC16 (#122) — variable Bauformen: BuildCardData trägt alle 7 Slots; blade/ratchet sind null,
// wenn die Bauform kein solches Teil hat (Custom Line bzw. Ratchet-Integrated). Die beiden
// Pure Helpers unten (buildPartSummary/buildDisplayName) zentralisieren die Anzeige-Reihenfolge
// für alle Oberflächen (Karte, Deck-Listen, Judge-Pad, Meta-Seite).
import Image from 'next/image'
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { TypeBadge } from '@/components/beyblade/TypeBadge'
import { WinRateBadge, type WinRateStats } from '@/components/beyblade/WinRateBadge'

export interface BuildCardPart {
  id: string
  name: string
  imageId?: string | null
}

export interface BuildCardData {
  id: string
  type: 'ATTACK' | 'DEFENSE' | 'STAMINA' | 'BALANCE'
  /** Standard/Ratchet-Integrated: das BLADE-Teil; null bei Custom Line. */
  blade: BuildCardPart | null
  /** Custom-Line-Stack — immer komplett belegt oder komplett null. */
  lockChip?: BuildCardPart | null
  overBlade?: BuildCardPart | null
  metalBlade?: BuildCardPart | null
  assistBlade?: BuildCardPart | null
  /** null bei Ratchet-Integrated (das Blade enthält das Ratchet). */
  ratchet?: BuildCardPart | null
  bit: BuildCardPart
  // Phase 11 — official Sets: retail product name + own Set photo (both optional; a
  // user-created combo carries neither).
  name?: string | null
  isOfficialSet?: boolean
  imageId?: string | null
  available?: boolean | null
  // Manufacturer retail SKU (e.g. Hasbro "F9580") — official Sets only, see Build.productCode.
  productCode?: string | null
}

// Anzeigereihenfolge der belegten Slots (RC16 #122).
const SUMMARY_ORDER = ['lockChip', 'blade', 'overBlade', 'metalBlade', 'assistBlade', 'ratchet', 'bit'] as const

/** „Teil · Teil · Teil" über alle belegten Slots — der Standard-Subtitle für Build-Zeilen. */
export function buildPartSummary(build: BuildCardData): string {
  return SUMMARY_ORDER.map((slot) => build[slot]).filter((p): p is BuildCardPart => Boolean(p)).map((p) => p.name).join(' · ')
}

/** Titel-Fallback-Kette: kuratierter Set-Name → Blade → Lock Chip (nie leer: Bit existiert immer). */
export function buildDisplayName(build: BuildCardData): string {
  return build.name ?? build.blade?.name ?? build.lockChip?.name ?? build.bit.name
}

export function BuildCard({ build, winRate }: { build: BuildCardData; winRate?: WinRateStats | null }) {
  const title = buildDisplayName(build)
  const imageId = build.imageId ?? build.blade?.imageId ?? build.lockChip?.imageId ?? null
  return (
    <Card className="p-4">
      <Link href={`/builds/${build.id}`} className="flex items-center gap-4">
        {imageId ? (
          <Image
            src={`/api/media/${imageId}`}
            alt={`Bild zu ${title}`}
            width={64}
            height={64}
            sizes="64px"
            className="h-16 w-16 rounded-lg object-contain"
          />
        ) : (
          <div aria-hidden="true" className="h-16 w-16 rounded-lg bg-x-cyan/10" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">
            {title}
            {build.isOfficialSet && <span className="ml-2"><Badge tone="cyan">Set</Badge></span>}
            {build.productCode && <span className="ml-2 text-xs font-normal text-current/50">{build.productCode}</span>}
          </p>
          <p className="truncate text-sm text-current/60">
            {buildPartSummary(build)}
          </p>
        </div>
        {/* Auto-Meta win-rate badge (Phase 5 Part D) — optional so existing callers keep
            working; list surfaces batch-read the cache and pass it in. */}
        <WinRateBadge stats={winRate ?? null} />
        {build.available !== undefined && build.available !== null && (
          <Badge tone={build.available ? 'cyan' : 'neutral'}>{build.available ? 'Baubar' : 'Teile fehlen'}</Badge>
        )}
        <TypeBadge type={build.type} />
      </Link>
    </Card>
  )
}
