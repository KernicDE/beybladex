// app/api/beyblades/route.ts (MVP4, #139/#141)
// GET — public Beyblade search as JSON (offizielle Sets). Konsument: der Set-Picker im
// MarkSetPurchasedForm (/collection?neu=1); der Katalog-Tab selbst ist server-rendered und
// nutzt lib/beybladeSearch.ts direkt. Cursor-paginated per the list-endpoint rule. Ein Query
// matcht Name ODER productCode (Präfix, case-insensitive).
import { searchBeyblades } from '@/lib/beybladeSearch'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const q = url.searchParams.get('q') ?? ''
  const cursor = url.searchParams.get('cursor')

  const { beyblades, nextCursor } = await searchBeyblades({ q, cursor })
  return Response.json(
    {
      beyblades: beyblades.map((b) => ({
        id: b.id,
        name: b.name,
        manufacturer: b.manufacturer,
        productCode: b.productCode,
        imageId: b.imageId,
        blade: b.blade,
        lockChip: b.lockChip,
        overBlade: b.overBlade,
        metalBlade: b.metalBlade,
        assistBlade: b.assistBlade,
        ratchet: b.ratchet,
        bit: b.bit,
      })),
      nextCursor,
    },
    { status: 200 },
  )
}
