// components/beyblade/BuildCard.tsx
// Build summary card — used on /builds and wherever a build row renders (deck builder
// picker results). The blade image goes through next/image with explicit sizing
// ([REVIEW-FIX: performance P12] — never an unoptimized <img> for catalog images).
import Image from 'next/image'
import Link from 'next/link'
import { Card } from '@/components/ui/Card'
import { TypeBadge } from '@/components/beyblade/TypeBadge'

export interface BuildCardData {
  id: string
  type: 'ATTACK' | 'DEFENSE' | 'STAMINA' | 'BALANCE'
  blade: { id: string; name: string; imageUrl: string | null }
  ratchet: { id: string; name: string }
  bit: { id: string; name: string }
}

export function BuildCard({ build }: { build: BuildCardData }) {
  return (
    <Card className="p-4">
      <Link href={`/builds/${build.id}`} className="flex items-center gap-4">
        {build.blade.imageUrl ? (
          <Image
            src={build.blade.imageUrl}
            alt={`Blade ${build.blade.name}`}
            width={64}
            height={64}
            sizes="64px"
            className="h-16 w-16 rounded-lg object-contain"
          />
        ) : (
          <div aria-hidden="true" className="h-16 w-16 rounded-lg bg-x-cyan/10" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{build.blade.name}</p>
          <p className="truncate text-sm text-current/60">
            {build.ratchet.name} · {build.bit.name}
          </p>
        </div>
        <TypeBadge type={build.type} />
      </Link>
    </Card>
  )
}
