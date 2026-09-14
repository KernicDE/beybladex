-- Backfill (#137 Root-Cause-Fix, lib/beybladePurchase.ts): POST /api/beyblades/[id]/purchases
-- (der "Als gekauft markieren"-Button auf der Beyblade-Detailseite — der Weg, den Nutzer:innen
-- tatsächlich gehen) schrieb bis zum Fix in derselben Woche NUR die Purchase-Zeile, nie die
-- CollectionItem-Provenienz. Bestehende Purchases aus dieser Zeit tragen deshalb "✓ Im Besitz"
-- im Katalog, tauchen aber nicht in "Mein Inventar" auf — genau der live gemeldete Bug.
--
-- Trägt einmalig nach: für jede (userId, beybladeId)-Kombination mit mindestens einem Kauf,
-- aber OHNE eine einzige existierende CollectionItem-Zeile mit passendem sourceBeybladeId,
-- werden die Teile-Zeilen für die belegten Slots des Sets angelegt — Kaufangaben (Preis/
-- Währung/Händler/Datum) vom JÜNGSTEN Kauf dieser Kombination (DISTINCT ON ... ORDER BY
-- "createdAt" DESC), analog zu lib/beybladePurchase.ts. Wer das Set bereits (z. B. über den
-- alten Weg /api/collection/mark-set-purchased) korrekt im Inventar hat, wird nicht angefasst
-- (die NOT EXISTS-Bedingung greift dann nicht) — kein doppeltes Nachtragen.
INSERT INTO "CollectionItem" ("id", "userId", "partOrBeyId", "purchasePrice", "currency", "merchant", "boughtAt", "sourceBeybladeId")
SELECT gen_random_uuid(), latest."userId", slot.part_id, latest."price", latest."currency", latest."merchant", latest."boughtAt", latest."beybladeId"
FROM (
  SELECT DISTINCT ON (p."userId", p."beybladeId")
    p."userId", p."beybladeId", p."price", p."currency", p."merchant", p."boughtAt"
  FROM "Purchase" p
  WHERE NOT EXISTS (
    SELECT 1 FROM "CollectionItem" ci
    WHERE ci."userId" = p."userId" AND ci."sourceBeybladeId" = p."beybladeId"
  )
  ORDER BY p."userId", p."beybladeId", p."createdAt" DESC
) latest
JOIN "Beyblade" b ON b."id" = latest."beybladeId"
CROSS JOIN LATERAL (
  VALUES (b."bladeId"), (b."lockChipId"), (b."overBladeId"), (b."metalBladeId"), (b."assistBladeId"), (b."ratchetId"), (b."bitId")
) AS slot(part_id)
WHERE slot.part_id IS NOT NULL;
