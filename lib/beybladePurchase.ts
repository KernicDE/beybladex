// lib/beybladePurchase.ts (#137-Nachtrag — Live-Bug-Report)
// Gemeinsame Schreiblogik für "Beyblade als gekauft markieren": schreibt EINE Purchase-Row
// (User ↔ Beyblade, Basis des Preisverlaufs) UND je belegtem Teile-Slot EINE verknüpfte
// CollectionItem-Row (Provenienz sourceBeybladeId) — beide in einer Transaktion (beide oder
// keine, kein halber Kauf).
//
// Vorher gab es hier zwei getrennte Implementierungen mit UNTERSCHIEDLICHEM Verhalten (PR #142
// hatte das absichtlich so gesplittet): POST /api/beyblades/[id]/purchases (der Button auf der
// Beyblade-Detailseite — der Weg, den echte Nutzer:innen tatsächlich gehen) schrieb NUR die
// Purchase-Row, ohne CollectionItem-Provenienz; nur POST /api/collection/mark-set-purchased
// (ein zweites Formular, erreichbar über /collection?tab=inventar&neu=1) schrieb beides. Live
// reproduziert: ein Nutzer markiert ein Set über die Detailseite als gekauft, sieht "✓ Im
// Besitz" im Katalog (Purchase-basiert), aber "Mein Inventar" (CollectionItem-basiert — laut
// eigenem Seiten-Kommentar "die Verfügbarkeitsgrundlage der Meine-Builds-Ansicht") bleibt leer.
// Beide Routen rufen jetzt dieselbe Funktion — kein Pfad ohne Provenienz mehr.
import { prisma } from '@/lib/db'

export interface BeybladePurchaseFields {
  price?: number | null
  currency?: string
  merchant?: string | null
  boughtAt?: Date | null
}

export async function createBeybladePurchase(
  userId: string,
  beybladeId: string,
  fields: BeybladePurchaseFields,
): Promise<{ error: 'not_found' } | { purchaseId: string; itemIds: string[] }> {
  const beyblade = await prisma.beyblade.findUnique({
    where: { id: beybladeId },
    select: {
      id: true,
      bladeId: true,
      lockChipId: true,
      overBladeId: true,
      metalBladeId: true,
      assistBladeId: true,
      ratchetId: true,
      bitId: true,
    },
  })
  if (!beyblade) return { error: 'not_found' }

  const price = fields.price ?? null
  const currency = fields.currency ?? 'EUR'
  const merchant = fields.merchant ?? null
  const boughtAt = fields.boughtAt ?? null

  // RC16 (#122) — je belegtem Slot eine CollectionItem-Row; leere Slots (Ratchet-Integrated,
  // CX-Blade) erzeugen bewusst keine Row.
  const partIds = [
    beyblade.bladeId,
    beyblade.lockChipId,
    beyblade.overBladeId,
    beyblade.metalBladeId,
    beyblade.assistBladeId,
    beyblade.ratchetId,
    beyblade.bitId,
  ].filter((id): id is string => id !== null)

  // Interactive transaction statt Array-Form: die CollectionItem-Zeilen brauchen die ECHTE
  // purchase.id (Issue #169 — purchaseId-Verknüpfung fürs Cascade-Löschen), die erst nach dem
  // purchase.create feststeht. Die Array-Form baut alle Promises VOR der Ausführung und kann
  // dieses Ergebnis nicht referenzieren.
  const { purchase, items } = await prisma.$transaction(async (tx) => {
    const purchase = await tx.purchase.create({
      data: { userId, beybladeId: beyblade.id, price, currency, merchant, boughtAt },
      select: { id: true },
    })
    const items = await Promise.all(
      partIds.map((partOrBeyId) =>
        tx.collectionItem.create({
          data: {
            userId,
            partOrBeyId,
            sourceBeybladeId: beyblade.id,
            purchaseId: purchase.id,
            purchasePrice: price,
            currency,
            merchant,
            boughtAt,
          },
          select: { id: true },
        }),
      ),
    )
    return { purchase, items }
  })
  return { purchaseId: purchase.id, itemIds: items.map((i) => i.id) }
}
