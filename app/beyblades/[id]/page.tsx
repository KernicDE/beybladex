// app/beyblades/[id]/page.tsx (MVP4, #139/#141)
// Beyblade-Detailseite (offizielles Set) — Minimal-Version zum Build-Split: Teile, abgeleiteter
// Typ/Spinrichtung, Hersteller, Product Code, Set-Bild. Bewertung, Preisverlauf, Kauf-Formular
// und "Build daraus erstellen" bauen in den Folge-Issues auf (Rating UI #143, IA/UX #144,
// Kauf-Flow #142) — die polymorphen Schema- und Lib-Grundlagen dafür sind mit #141 gelegt.
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/db'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { TypeBadge } from '@/components/beyblade/TypeBadge'
import { deriveAssemblyTraits } from '@/lib/assembly'
import { formatBitDisplay } from '@/lib/buildNaming'

export const dynamic = 'force-dynamic'

export default async function BeybladeDetailPage({ params }: PageProps<'/beyblades/[id]'>) {
  const { id } = await params

  const beyblade = await prisma.beyblade.findUnique({
    where: { id },
    include: {
      blade: true,
      lockChip: true,
      overBlade: true,
      metalBlade: true,
      assistBlade: true,
      ratchet: true,
      bit: true,
    },
  })
  if (!beyblade) notFound()

  const traits = deriveAssemblyTraits(beyblade.blade, beyblade.lockChip)

  const parts = [
    { label: 'Lock Chip', part: beyblade.lockChip },
    { label: 'Blade', part: beyblade.blade },
    { label: 'Over Blade', part: beyblade.overBlade },
    { label: 'Metal Blade', part: beyblade.metalBlade },
    { label: 'Assist Blade', part: beyblade.assistBlade },
    { label: 'Ratchet', part: beyblade.ratchet },
    { label: 'Bit', part: beyblade.bit },
  ].filter((p): p is { label: string; part: (typeof p.part & object) } => p.part !== null)

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <Link href="/collection?tab=katalog" className="text-sm text-current/60 underline underline-offset-2">← Katalog</Link>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">
              {beyblade.name}
              {beyblade.productCode && <span className="ml-2 text-base font-normal text-current/50">{beyblade.productCode}</span>}
            </h1>
            <p className="text-current/60">
              {/* RC16 (#106): Bit als „Kurzcode (Vollname)". */}
              {parts.map((p) => (p.part.category === 'BIT' ? formatBitDisplay(p.part.name) : p.part.name)).join(' · ')}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <Badge tone="neutral">{beyblade.manufacturer}</Badge>
              {traits?.spinDirection && (
                <Badge tone="neutral">{traits.spinDirection === 'RIGHT' ? 'Rechtsdrehend' : 'Linksdrehend'}</Badge>
              )}
            </div>
          </div>
          {traits?.beyType && <TypeBadge type={traits.beyType} />}
        </div>
      </Card>

      <section aria-labelledby="beyblade-parts" className="space-y-3">
        <h2 id="beyblade-parts" className="text-lg font-semibold">Teile</h2>
        <ul className="grid gap-3 sm:grid-cols-3">
          {parts.map(({ label, part }) => (
            <li key={part.id}>
              <Link href={`/parts/${part.id}`} className="block transition-opacity hover:opacity-80">
                <Card className="h-full p-4 text-center">
                  {part.imageId ? (
                    <Image
                      src={`/api/media/${part.imageId}`}
                      alt={part.name}
                      width={96}
                      height={96}
                      sizes="96px"
                      className="mx-auto h-24 w-24 rounded-lg object-contain"
                    />
                  ) : (
                    <div aria-hidden="true" className="mx-auto h-24 w-24 rounded-lg bg-x-cyan/10" />
                  )}
                  <p className="mt-2 font-medium">
                    {part.category === 'BIT' ? formatBitDisplay(part.name) : part.name}
                  </p>
                  <p className="text-sm text-current/60">{label}</p>
                  <div className="mt-1 flex justify-center gap-1">
                    <Badge tone="cyan">{part.category}</Badge>
                    {part.beyType && <TypeBadge type={part.beyType} />}
                  </div>
                  {part.weightGrams && <p className="mt-1 text-xs text-current/50">{part.weightGrams} g</p>}
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  )
}
