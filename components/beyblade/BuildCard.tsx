// components/beyblade/BuildCard.tsx
// Build summary card — used on /builds and wherever a build row renders (deck builder
// picker results). Part/Set images are MediaAssets served by the generic /api/media/[id]
// route (Phase 11's pipeline) and go through next/image with explicit sizing
// ([REVIEW-FIX: performance P12] — never an unoptimized <img> for catalog images).
import Image from 'next/image'
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { TypeBadge } from '@/components/beyblade/TypeBadge'
import { WinRateBadge, type WinRateStats } from '@/components/beyblade/WinRateBadge'

export interface BuildCardData {
  id: string
  type: 'ATTACK' | 'DEFENSE' | 'STAMINA' | 'BALANCE'
  blade: { id: string; name: string; imageId: string | null }
  ratchet: { id: string; name: string }
  bit: { id: string; name: string }
  // Phase 11 — official Sets: retail product name + own Set photo (both optional; a
  // user-created combo carries neither).
  name?: string | null
  isOfficialSet?: boolean
  imageId?: string | null
  available?: boolean | null
}

export function BuildCard({ build, winRate }: { build: BuildCardData; winRate?: WinRateStats | null }) {
  const title = build.name ?? build.blade.name
  const imageId = build.imageId ?? build.blade.imageId
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
          </p>
          <p className="truncate text-sm text-current/60">
            {build.blade.name} · {build.ratchet.name} · {build.bit.name}
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
