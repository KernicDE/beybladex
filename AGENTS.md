<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Deployment & Versionierung (issue #77)

## Deploy-Flow

Merge nach `main` → `ci.yml` (Tests + Docker-Boot-Test) → `deploy.yml` (baut Image, pusht `ghcr.io/kernicde/beybladex:latest`) → Watchtower auf dem Live-Server (nicolas@kernic.net, `/opt/docker/beybladex/app-beybladex`) pullt und recreated den Container automatisch (nachts). Migrationen laufen im Container-CMD bei jedem Start (`npx prisma migrate deploy`) — **auf JEDER Umgebung, die den Container startet**, also auch auf Test. **Kein lokaler Docker** — Entwickeln, mergen, builden lassen (CI), auf dem Server testen. Manuelle Updates auf dem Server: `docker compose pull app && docker compose up -d app` im jeweiligen Umgebungs-Verzeichnis (siehe „Deploy-Umgebungen: Live und Test" unten).

**Achtung Compose-Drift (Lesson vom 11.09.2026, Hotfix #115):** Die auf dem Server liegende `compose.yml`/`compose.test.yml` ist eine eigene Kopie — sie driftet leise hinter dem Repo-Stand. Nach JEDER manuellen Server-Änderung und vor jedem GoLive (Live UND Test): Server-Kopie gegen das Repo diffen (Live: `diff <(ssh nicolas@kernic.net "cat /opt/docker/beybladex/app-beybladex/compose.yml") compose.yml`; Test: siehe unten, Dateiname auf dem Server weicht ab). Fehlende Volume-Mounts (z. B. `media_uploads`) führen zu **stillen Datenverlusten bei jedem Deploy** — der Container-Fs ist ephemeral, Uploads ohne Bind-Mount sind beim nächsten Recreate weg, die DB-Zeilen bleiben als 404er zurück.

## GoLive-Policy: nur Test, bis ausdrücklich freigegeben (Stand 15.09.2026)

**Standing-Anweisung, gilt bis der Nutzer explizit widerspricht:** nach einem
Merge nach `main` wird **nur die Test-Umgebung** manuell aktualisiert (siehe
unten). **Live wird NICHT manuell angefasst**, bis der Nutzer ausdrücklich
sagt, dass etwas live gehen soll (z. B. „bring das live", „GoLive für Live",
„Live aktualisieren"). CI/`deploy.yml` laufen bei jedem Merge unverändert
weiter (bauen + pushen des Images) — das betrifft nur den Build, nicht den
Rollout. Diese Policy überschreibt bis auf Widerruf den obigen „Neuer
Build/GoLive"-Absatz im Release-Workflow für Live (Test bleibt davon
unberührt, dort wird nach jedem grünen Merge normal ausgerollt).

**Achtung Watchtower-Ausnahme:** Watchtower läuft auf dem Live-Container
unverändert weiter und pullt/recreated `:latest` automatisch nachts (ca. 3
Uhr) — das ist außerhalb der Agenten-Kontrolle und keine Verletzung dieser
Policy. Wer Live wirklich eingefroren halten will, muss das Watchtower-Label
am Live-Container selbst deaktivieren (nicht Teil dieser Anweisung, nur auf
expliziten Wunsch).

## Versionsschema: CalVer + Build-Identifier

`YYYY.MM.DD+shortsha` — z. B. `2026.09.10+2282d4c` (UTC-Datum des Merges + Kurz-SHA des deployed Commits). Bewusst **kein SemVer**: jeder Merge ist ein Release, manuelle Bump-Entscheidungen würden im AI-getriebenen Flow verrotten.

- **Quelle der Wahrheit** ist die `APP_VERSION`-Env-Variable, die `deploy.yml` aus Merge-Datum + SHA berechnet und als Build-Arg bäckt (Dockerfile `ENV APP_VERSION`); zusätzlich als OCI-Label (`org.opencontainers.image.version`/`.revision`) am Image für `docker inspect`.
- **Lokal/Tests**: kein `APP_VERSION` gesetzt → Fallback `0.0.0-dev+local` in `lib/version.ts`. Diesen Fallback niemals auf eine „echte" Version setzen.
- `package.json`'s statisches `"version": "0.1.0"` ist **nicht** die Quelle der Wahrheit (npm verlangt das Feld) — nicht manuell bumpen.

## Version zur Laufzeit

- `GET /api/version` (öffentlich): `{ version, date, commit }`
- Footer zeigt `v<APP_VERSION>` (Desktop)

## Bugreports

Supportfälle referenzieren die Version aus dem Footer oder `https://beybladex.de/api/version` — daran ist Datum und exakter Commit des laufenden Deploys ablesbar.

<!-- BEGIN:beybladex-release-workflow -->

# Release-Workflow: Milestone für Milestone

**Stand 13.09.2026:** Die bisherige Milestone-Staffel (RC0 → RC16, Catalog,
Hotfix-Milestone) ist vollständig abgeschlossen und live — alle Milestones sind
geschlossen. Der Workflow bleibt als verbindliches Regelwerk für künftige
Milestones bestehen.

- Arbeit ist in GitHub-Milestones organisiert: jeweils ein thematisches Paket
  (~5 Issues) für einen Agenten. Übersicht (auch historische, geschlossene):
  `gh api repos/KernicDE/beybladex/milestones?state=all`
- **Die Reihenfolge ist bindend:** ein Milestone nach dem anderen, beginnend mit
  dem niedrigsten noch offenen. Nicht parallel in mehreren Milestones arbeiten.
- **Neuer Build / GoLive findet erst statt, wenn ein Milestone vollständig
  abgeschlossen ist** (alle seine Issues geschlossen und auf `main` gemerged).
  Dazwischen keine Releases und keine GoLives.
- **Sobald ein Issue bearbeitet wird, wird es `KernicDE` zugewiesen**
  (`gh issue edit <nr> --add-assignee KernicDE`) — der Assignee zeigt, wer
  gerade daran arbeitet. Es wird allein gearbeitet; ein Claimen per
  Kommentar-UUID ist nicht nötig.
- Vor dem Anlegen neuer Issues prüfen, ob ein offenes Issue das Thema bereits
  abdeckt — Duplikate vermeiden.
- **Vor jedem GoLive** die Server-`compose.yml` gegen das Repo diffen
  (Compose-Drift-Regel oben).
- Es wird niemals lokal Docker gestartet. Workflow: entwickeln → Typecheck/Tests
  lokal → PR → CI grün → mergen. **GoLive manuell auf dem Server**: in
  `/opt/docker/beybladex/app-beybladex` → `docker compose pull app && docker
  compose up -d app` (Watchtower allein zieht nur nachts um 3). Danach auf dem
  Server verifizieren (Container healthy, keine Pending Migrations,
  `/api/health`, `/api/version` passt zum Merge-Commit).

<!-- END:beybladex-release-workflow -->

<!-- BEGIN:beybladex-terminology -->

# Terminologie: „events" vs. „tournaments" (RC6, issue #69)

Für das Turnier-Aggregat existierten zwei Namen: `events` (öffentliche Seiten
`/events/*`) und `tournaments` (Prisma-Modell `Tournament`, API `/api/tournaments/*`).

**Entscheidung (verbindlich):** „Tournament" ist der kanonische Begriff für
Datenmodell, API und Code-Identifier (Module, Funktionen, Komponenten,
Cache-Keys). „Event" bleibt ausschließlich als öffentlicher UI-/URL-Begriff
bestehen: die Route `/events/*` ist die bewusste IA-Entscheidung (Task 13) für
die öffentliche Detailseite (SEO, geteilte Bookmarks) und deutsches
Marketing-Vokabular — ein Alias für dasselbe Aggregat, kein zweites Konzept.

**Begründung:** Das Prisma-Modell und die API umzubenennen ist zu invasiv
(Migration aller FKs, Routen, Clients — siehe Issue-Kontext), und die
öffentlichen URLs zu brechen kostet SEO und geteilte Links ohne Nutzen. Zwei
URL-Familien sind hier kein Drift, sondern Trennung von öffentlicher
(„Event") und operativer/„competitive" Oberfläche („Turnier").

**Konsequenzen:**

- Neuer Code benennt das Aggregat immer `tournament` — auch in Komponenten auf
  `/events/*`-Seiten (Referenz: `TournamentShareQR`, Cache-Key
  `public:v1:tournament:*`, `lib/tournamentService.ts`).
- Bestehende Routen/Pfade werden NICHT umbenannt; `/events/*` bleibt stabil.

**Migrationsplan (falls je vollständige Vereinheitlichung gewünscht):**
(1) Dokumentation (dieser Abschnitt) ✅ · (2) internes Naming folgt dem
Standard bei jeder angefassten Datei ✅ (RC6) · (3) optional später:
`/tournaments/[id]`-Detailroute einführen und `/events/[id]` per
permanentem Redirect (308) dorthin umleiten, QR-Codes/Shares migrieren —
nur mit SEO-Begleitung (canonical, Sitemap), nicht als Refactor-Beifang.

<!-- END:beybladex-terminology -->

# Deploy-Umgebungen: Live und Test (Stand 15.09.2026)

Zwei dauerhafte, komplett unabhängige Umgebungen laufen nebeneinander auf
demselben Server (nicolas@kernic.net) — eigene Container, eigene DB, eigener
Redis, eigene Volumes, eigenes Docker-Netzwerk pro Umgebung. Beide laufen
dasselbe Image (`ghcr.io/kernicde/beybladex:latest`); nichts wird zwischen
ihnen geteilt oder gespiegelt außer dem einmalig kopierten Katalog (s. u.).

| | **Live** | **Test** |
|---|---|---|
| URL | https://beybladex.de | https://test.beybladex.de |
| Server-Verzeichnis | `/opt/docker/beybladex/app-beybladex` | `/opt/docker/beybladex/app-beybladex-test` |
| Compose-Datei (Repo) | `compose.yml` | `compose.test.yml` |
| Compose-Datei (Server, **Achtung Namensabweichung**) | `compose.yml` | ebenfalls `compose.yml` (NICHT `compose.test.yml`!) — Diff-Befehl unten entsprechend anpassen |
| Container-Namen | `beybladex_app` / `_db` / (kein eigener Redis-Container-Präfix nötig, da separates Netz) | `beybladex_test_app` / `_test_db` / `_test_redis` |
| Watchtower | **aktiv** — pullt/recreated `:latest` automatisch nachts (~3 Uhr) | **inaktiv** — kein Watchtower-Label, nur manuelles GoLive |
| GoLive-Befehl | `cd /opt/docker/beybladex/app-beybladex && docker compose pull app && docker compose up -d app` | `cd /opt/docker/beybladex/app-beybladex-test && docker compose pull app && docker compose up -d app` |
| Nutzdaten | echte Produktionsdaten | rein synthetisch, siehe unten |
| SMTP/Web-Push/DeepL | konfiguriert, sendet wirklich | **bewusst NICHT gesetzt** (lib/mailer.ts / lib/webPush.ts / lib/i18n/deepl.ts degradieren graceful) — eine Umgebung voller Fake-User darf nie wirklich E-Mails oder Push-Notifications verschicken |
| DB-Port nach außen | nicht exponiert | `127.0.0.1:5433` (nur loopback, nie öffentlich) |

**Compose-Drift-Check für Test** (Pendant zur Live-Regel oben, Dateiname auf
dem Server beachten):
```
diff <(ssh nicolas@kernic.net "cat /opt/docker/beybladex/app-beybladex-test/compose.yml") compose.test.yml
```

**Seit 15.09.2026 gilt die GoLive-Policy oben: routinemäßig wird nur Test
ausgerollt.** Live-GoLive nur auf ausdrückliche Anweisung.

## Test: Katalog

Part/Beyblade/MediaAsset wurden 1:1 aus Live kopiert (`pg_dump` → `psql
COPY`, plus die referenzierten `.webp`-Dateien aus dem `media_uploads`-Volume)
— dieselben Beyblades/Teile wie auf beybladex.de, keine Fake-Daten im
Katalog. Diese Kopie ist einmalig und wird NICHT laufend synchronisiert —
neue Parts/Beyblades, die auf Live angelegt werden, erscheinen nicht
automatisch auf Test.

## Test: Community-/Wettkampfdaten

`scripts/seedTestEnvironment.ts` erzeugt 500 User (Login: `testenv_admin` /
`TestEnv2026!`, gleiches Passwort für alle 500), 15 Clubs, 40 Teams, 2
Seasons und 50 Turniere — die meisten davon vollständig simuliert (echte
Bracket-/Swiss-Propagation, Elo, Platzierung) über `lib/bracket.ts`/
`lib/stageFlow.ts`/`lib/season.ts`/`lib/tournamentPlacement.ts`, nicht
handgestrickt. `testenv_admin` hat `role: ADMIN` plus `isJudge`/`isOrganizer`
beide `true` (issue #199 follow-up — additive Capabilities, s. u.); ein Teil
der übrigen User bekommt ebenfalls `isJudge`/`isOrganizer` gesetzt, damit
Judge-Zuweisung und Turniererstellung testbar sind. Läuft NICHT idempotent —
nur gegen eine frisch migrierte, community-daten-leere Test-DB ausführen
(siehe die Kommentare im Skript für die genaue Vorgehensweise inkl.
Katalog-Kopie).

## Test: DB-Zugriff

`beybladex_test_db` exponiert `127.0.0.1:5433` auf dem Server (nie
öffentlich) — Zugriff nur per SSH-Tunnel (`ssh -L 5433:localhost:5433
nicolas@kernic.net`). Für Bulk-Operationen (Seeding, große Updates) ist ein
SSH-Tunnel wegen Round-Trip-Latenz pro Query oft zu langsam/unzuverlässig —
schneller: ein Wegwerf-Container (`node:22-alpine`) direkt auf dem Server, per
Bind-Mount mit dem getarten Source verbunden, am `beybladex_test_internal`
-Netzwerk hängend, läuft `npx tsx <script>.ts` direkt gegen `db:5432` ohne
Tunnel. `REDIS_URL=redis://redis:6379` muss dabei explizit gesetzt werden
(sonst versucht `lib/notify.ts`, `localhost:6379` zu erreichen und loggt
`ECONNREFUSED`, harmlos aber laut). Für einzelne SQL-Statements reicht auch
`docker exec beybladex_test_db psql -U beybladex_test_user -d
beybladex_test_db -c "..."` direkt auf dem Server, ganz ohne Tunnel oder
Wegwerf-Container.

## Additive Rollen: Judge/Organizer (issue #199 follow-up, 15.09.2026)

`User.isJudge` und `User.isOrganizer` sind unabhängige Booleans, orthogonal
zur Trust-Leiter `GUEST < USER < TRUSTED < ADMIN` (`User.role`). Jede
Kombination ist möglich — z. B. `TRUSTED` + `isJudge` + `isOrganizer`
gleichzeitig. Der `Role`-Enum behält seine `JUDGE`/`ORGANIZER`-Werte nur für
Altbestand in der DB (Migration `20260915150000_...` hat bestehende
JUDGE/ORGANIZER-Rollen in die neuen Flags übernommen und die Rolle auf
`TRUSTED` zurückgestuft) — neuer Code darf diese Enum-Werte nie mehr
schreiben oder prüfen; einzige Quelle der Wahrheit sind die beiden Flags.
Betrifft `lib/roles.ts` (`CURATOR_ROLES`/`isCurator`), `lib/guards.ts`
(`requireCurator`), Turniererstellung, Judge-Zuweisung, Club-Event-Erstellung.
