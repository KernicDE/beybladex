-- Issue #169 — bestehende CollectionItem-Zeilen (aus VOR dieser Migration erzeugten Käufen)
-- hatten noch keinen purchaseId-Bezug. Verknüpft sie nachträglich, aber NUR wo eindeutig: genau
-- eine Purchase-Zeile für dieselbe User+Beyblade-Kombination. Kaufte jemand dieselbe Beyblade
-- mehrfach, ist nicht rekonstruierbar, welche Teile-Zeile zu welchem Kauf gehört (die
-- Provenienz-Spalte sourceBeybladeId trackt nur "welche Beyblade", nicht "welcher Kauf") — diese
-- Alt-Fälle bleiben bewusst mit purchaseId NULL (löscht man einen von mehreren Käufen derselben
-- Beyblade, werden für diese Nutzerin/diesen Nutzer wie bisher keine Teile mitgelöscht; ab dieser
-- Migration erzeugte Käufe sind davon nicht betroffen, siehe lib/beybladePurchase.ts). Idempotent.
UPDATE "CollectionItem" ci
SET "purchaseId" = p.id
FROM "Purchase" p
WHERE ci."sourceBeybladeId" = p."beybladeId"
  AND ci."userId" = p."userId"
  AND ci."purchaseId" IS NULL
  AND (
    SELECT COUNT(*) FROM "Purchase" p2
    WHERE p2."beybladeId" = ci."sourceBeybladeId" AND p2."userId" = ci."userId"
  ) = 1;
