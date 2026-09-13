# BeybladeX.de

Die DACH-Community-Plattform für **Beyblade X** — Events, Turniere, Clubs, Sammlung und Meta. Live unter [beybladex.de](https://beybladex.de).

Ein Next.js-PWA-Monolith mit offline-fähiger Turnier-Judge-UI, eigenener Ruleset-getriebener Turnier-Engine und dem offiziellen Teile-Katalog — gebaut für die deutschsprachige Community, mehrsprachig (de/en).

## Features (live)

- **Events & Turniere**: DACH-Eventkalender mit Umkreissuche, Leaflet-Karte und RSS-Feeds; Turniererstellung, Anmeldung, QR-Check-in und Brackets für Single-/Double-Elimination, Swiss, Round Robin — auch mehrstufig in einem Turnier
- **3-vs-3 Team-Modus**: Team-Wettkampfformat analog der WBO Masters League — Deck-Lock-in und Matches über drei Sets
- **Offline-Judge-PWA**: Match-Scoring funktioniert ohne Netzwerk (IndexedDB-Queue, idempotenter Sync, Wake-Lock, Daumenzonen-Layout) und synchronisiert automatisch bei Reconnect
- **Regelwerk**: konfigurierbare `Ruleset`-Engine (kein Hardcoding) inkl. World Beyblade Organization Rules und Blader League Germany Rules, WoB-Standard-Checklisten für Judges
- **Rangliste & Elo**: saisonbasiertes Elo-Rating, öffentliche Rangliste, rating-basiertes Bracket-Seeding
- **Auto-Meta-Engine**: Win-Rate-Auswertung pro Part/Build aus echten, richterbestätigten Matchergebnissen (`/meta`)
- **Sammlung & Katalog**: offizieller Teile-/Set-Katalog (inkl. Custom Line & Ratchet-Integrated), Sammlungsverwaltung mit Mehrwährungsumrechnung (EUR/CHF/USD) und Preisverlauf
- **Builds & Decks**: Build-Verwaltung mit kanonischer Benennung und Duplikatsschutz, Deckbuilder mit Server-seitiger Duplikatsprüfung und Ruleset-getriebenen Deckregeln
- **Clubs & Social**: Freundschaften, Clubs mit Chat und Beitrittsrichtlinien, Profil mit granularer Feld-Sichtbarkeit (`PUBLIC` / `FRIENDS_ONLY` / `PRIVATE`)
- **Benachrichtigungen**: Web Push + E-Mail, Turnier-/Match-Lebenszyklus-Trigger, SSE über Redis Pub/Sub
- **Auth**: Passwort, optional E-Mail, Passkeys (WebAuthn/FIDO2), TOTP-2FA, kein Cookie für anonyme Besucher, DSGVO-konformer Elternzustimmungs-Flow für Minderjährige
- **i18n**: Deutsch/Englisch über Request-Dictionaries, optional DeepL-gestützte Übersetzungshilfe
- **PWA/Offline**: installierbar, Service Worker mit Caching, offline-fähige Kernflows
- **Datenschutz**: Impressum/Datenschutzerklärung, Art.-16/17/20-Selbstbedienung (Berichtigung, Löschung/Anonymisierung, Datenexport), datensparsame Defaults

## Tech-Stack

Next.js 16 (App Router, Server Actions) · TypeScript · Tailwind CSS v4 (CSS-first, kein `tailwind.config.ts`) · Prisma ORM · PostgreSQL 16 · Redis 7 (Cache, Rate-Limits, Pub/Sub/SSE) · NextAuth (Credentials + WebAuthn + TOTP) · Leaflet.js · Vitest + Testing Library + Playwright · Docker (Image auf GHCR) · Traefik · Watchtower · GitHub Actions.

**Versionierung**: CalVer `YYYY.MM.DD+shortsha` (z. B. `2026.09.10+2282d4c`), gebacken in `APP_VERSION` beim Deploy. Laufende Version öffentlich unter [`/api/version`](https://beybladex.de/api/version) und im Footer.

**Grundsatz**: keine externen CDN-Aufrufe zur Laufzeit — Fonts, Icons und JS-Bibliotheken sind gebundlet/self-hosted, gegen Regression abgesichert durch `tests/unit/no-external-resources.test.ts`.

## Lokale Entwicklung

```bash
npm install
cp .env.example .env   # Werte anpassen, siehe Kommentare in der Datei
npm run dev
```

**Kein lokales Docker für Postgres/Redis** (bewusste Betreiber-Entscheidung) — echte Infrastruktur existiert nur in CI und auf dem Deploy-Server:

```bash
npm test              # Unit-Tests (vitest run tests/unit) — keine externen Abhängigkeiten
npm run test:integration   # Integrationstests — braucht echtes Postgres/Redis, nur in CI
npm run test:all      # beide zusammen (der Befehl, den ci.yml nutzt)
npm run test:e2e          # Playwright gegen den Dev-Server
npm run test:e2e:offline  # Playwright gegen einen echten Production-Build (Offline-Judge-Spec)
npx tsc --noEmit       # Typecheck
```

Neue Migrationen werden lokal per `prisma migrate diff` erzeugt (ohne Live-DB) und ausschließlich von CI/dem Deploy-Container per `prisma migrate deploy` angewendet — siehe Kommentare in `prisma/migrations/`.

## Contributing & Agent-Workflow

Der verbindliche Arbeitsablauf steht in [`AGENTS.md`](AGENTS.md): milestone-basiertes Arbeiten (Reihenfolge bindend, ein GoLive pro abgeschlossenem Milestone), Assignee-Regel, kein lokales Docker — **das Gate ist CI** (Tests + Docker-Boot-Test, danach Deploy via `deploy.yml`). `CLAUDE.md` verweist auf `AGENTS.md`.

## Deployment

Docker-Image → GHCR (`ghcr.io/kernicde/beybladex:latest`), gebaut von GitHub Actions (`deploy.yml`, ausgelöst nach grüner CI), hinter Traefik auf `nicolas@kernic.net`, automatisch aktualisiert durch Watchtower. Migrationen laufen im Container-CMD bei jedem Start (`npx prisma migrate deploy`). Details, Topologie und Betriebs-Gotchas: `compose.yml`, `Dockerfile`, sowie die Abschnitte in der [Masterplan-Datei](docs/superpowers/plans/2026-09-08-beybladex-master-plan.md).

## Projektstand & Roadmap

Der vollständige, laufend aktualisierte Implementierungsplan liegt in [`docs/superpowers/plans/2026-09-08-beybladex-master-plan.md`](docs/superpowers/plans/2026-09-08-beybladex-master-plan.md). Kurzfassung (Stand 13.09.2026):

| Stufe | Umfang | Status |
|---|---|---|
| **MVP1** | Phasen 1–6: Fundament, Design-System, Auth, Regel-Editor, DACH-Kalender & Social, Deck-/Sammlungs-/Turniermanager mit Offline-Judge-UI & Auto-Meta, CI/CD-Pipeline | ✅ **Live** auf beybladex.de |
| **[MVP1.5](https://github.com/KernicDE/beybladex/milestone/1)** | Phasen 7–13: QR-Workflows & Zahlungsverfolgung, Markdown-Authoring, Bild-Upload-Pipeline mit Community-Vorschlagssystem, Club-Chat u. v. m. | ✅ Abgeschlossen (7/7 gemerged) |
| **[MVP2](https://github.com/KernicDE/beybladex/milestone/2)** | Phasen 14–20 + 21: Ranglisten-System mit Elo-Rating, Dual-Spin-Part-Modus, Branding, Push-Benachrichtigungen, Build-Benennung & Duplikatsschutz, Avatare | ✅ Abgeschlossen (8/8 gemerged) |
| **[MVP3](https://github.com/KernicDE/beybladex/milestone/3)** | 3-vs-3-Team-Wettkampfformat (analog WBO Masters League) | ✅ Abgeschlossen — live (RC15) |
| **RC0–RC16, Catalog, Hotfix** | Härtung (Security, Reliability, Performance), UX-Politur, Landing-Page, i18n, Sammlung/Builds/Bewertungen, Custom-Line-Katalog | ✅ Abgeschlossen — alle Milestones geschlossen (13.09.2026) |

Jede Phase in der Masterplan-Datei ist bis auf Datei-/Interface-/Akzeptanzkriterien-Ebene spezifiziert. Fortschritt wird über [GitHub Issues](https://github.com/KernicDE/beybladex/issues) getrackt; künftige Arbeit ist in neuen Milestones organisiert (siehe `AGENTS.md`).

## Lizenz

Privates Projekt, kein Open-Source-Lizenzmodell definiert.
