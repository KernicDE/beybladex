-- Backfill (#164 Live-Report, Screenshot "hier steht kein Name"): Build.name war bei
-- Alt-Zeilen (vor der "leer → null"-Regel aus PATCH /api/builds/[id], #145/#164) teils als
-- leerer oder nur-Leerzeichen-String statt NULL gespeichert. buildDisplayName()
-- (components/beyblade/BuildCard.tsx) fällt NUR bei NULL auf den kanonischen Namen
-- (Blade/Lock Chip/Bit) zurück — bei einem leeren String stand deshalb eine leere Titelzeile
-- da. Der Code-Fix behandelt "" ab jetzt defensiv wie NULL; dieser Backfill räumt zusätzlich
-- die bestehenden Daten auf, damit z. B. rohe API-Konsumenten (nicht über buildDisplayName)
-- ebenfalls den korrekten Zustand sehen. Idempotent — ein zweiter Lauf trifft keine Zeile mehr.
UPDATE "Build" SET "name" = NULL WHERE "name" IS NOT NULL AND trim("name") = '';
