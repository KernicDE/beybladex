<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Deployment & Versionierung (issue #77)

## Deploy-Flow

Merge nach `main` → `ci.yml` (Tests + Docker-Boot-Test) → `deploy.yml` (baut Image, pusht `ghcr.io/kernicde/beybladex:latest`) → Watchtower auf dem Server (nicolas@kernic.net, `/opt/docker/beybladex/app-beybladex`) pullt und recreated den Container. Migrationen laufen im Container-CMD bei jedem Start (`npx prisma migrate deploy`). **Kein lokaler Docker** — Entwickeln, mergen, builden lassen (CI), auf dem Server testen. Manuelle Updates auf dem Server: `docker compose pull app && docker compose up -d app`.

**Achtung Compose-Drift (Lesson vom 11.09.2026, Hotfix #115):** Die auf dem Server liegende `compose.yml` ist eine eigene Kopie — sie driftet leise hinter dem Repo-Stand. Nach JEDER manuellen Server-Änderung und vor jedem GoLive: Server-Kopie gegen das Repo diffen (`diff <(ssh nicolas@kernic.net "cat /opt/docker/beybladex/app-beybladex/compose.yml") compose.yml`). Fehlende Volume-Mounts (z. B. `media_uploads`) führen zu **stillen Datenverlusten bei jedem Deploy** — der Container-Fs ist ephemeral, Uploads ohne Bind-Mount sind beim nächsten Recreate weg, die DB-Zeilen bleiben als 404er zurück.

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

- Offene Arbeit ist in GitHub-Milestones organisiert: **RC0 → RC15**, jeweils ein
  thematisches Paket (~5 Issues) für einen Agenten. Übersicht:
  `gh api repos/KernicDE/beybladex/milestones`
- **Die Reihenfolge ist bindend:** ein Milestone nach dem anderen, beginnend mit
  dem niedrigsten noch offenen RC. Nicht parallel in mehreren Milestones arbeiten.
- **Neuer Build / GoLive findet erst statt, wenn ein Milestone vollständig
  abgeschlossen ist** (alle seine Issues geschlossen und auf `main` gemerged).
  Dazwischen keine Releases und keine GoLives.
- **Sobald ein Issue bearbeitet wird, wird es `KernicDE` zugewiesen**
  (`gh issue edit <nr> --add-assignee KernicDE`) — der Assignee zeigt, wer
  gerade daran arbeitet. Es wird allein gearbeitet; ein Claimen per
  Kommentar-UUID ist nicht nötig.
- Vor dem Anlegen neuer Issues prüfen, ob ein offenes Issue das Thema bereits
  abdeckt — Duplikate vermeiden.
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
