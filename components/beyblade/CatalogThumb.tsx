// components/beyblade/CatalogThumb.tsx (Issue #188)
// Shared image block for the Sammlung page's three tabs (Beyblades/Teile/Mein Inventar):
// the catalog image with two abbreviated markers directly underneath it — manufacturer
// (TT/H) flush with the image's LEFT edge, spin direction (R/L) flush with its RIGHT edge.
// Replaces the previous full-word "Takara Tomy"/"Hasbro"/"Rechtsdrehend"/"Linksdrehend"
// badges that lived in the name row — those took real estate and repeated on every card,
// where a two-letter marker under the image reads just as clearly at a glance.
import Image from 'next/image'

export function CatalogThumb({
  imageId,
  alt,
  size = 64,
  manufacturer,
  spinDirection,
}: {
  imageId: string | null
  alt: string
  size?: number
  manufacturer: 'TT' | 'HASBRO'
  /** null — z. B. eine Beyblade ohne verifiziertes Blade-/Lock-Chip-Teil — lässt den rechten
   *  Marker einfach weg, statt eine falsche Drehrichtung zu behaupten. */
  spinDirection: 'RIGHT' | 'LEFT' | null
}) {
  return (
    <div className="shrink-0" style={{ width: size }}>
      {imageId ? (
        <Image
          src={`/api/media/${imageId}`}
          alt={alt}
          width={size}
          height={size}
          sizes={`${size}px`}
          className="rounded-lg object-contain"
          style={{ width: size, height: size }}
        />
      ) : (
        <div aria-hidden="true" className="rounded-lg bg-x-cyan/10" style={{ width: size, height: size }} />
      )}
      <div className="mt-1 flex items-center justify-between text-[10px] font-semibold text-current/50">
        <span title={manufacturer === 'TT' ? 'Takara Tomy' : 'Hasbro'}>{manufacturer === 'TT' ? 'TT' : 'H'}</span>
        {spinDirection && (
          <span title={spinDirection === 'RIGHT' ? 'Rechtsdrehend' : 'Linksdrehend'}>{spinDirection === 'RIGHT' ? 'R' : 'L'}</span>
        )}
      </div>
    </div>
  )
}
