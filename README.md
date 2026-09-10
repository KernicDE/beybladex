# BeybladeX.de

Die DACH-Region-Community-, Sammlungs-, Social- und Turnier-Plattform für **Beyblade X**. Live unter [beybladex.de](https://beybladex.de).

Ein Next.js-PWA-Monolith mit offline-fähiger Turnier-Judge-UI, Regel-Editor, DACH-Eventkalender (inkl. RSS), Social/Club-Funktionen, Sammlungs- und Deckmanager sowie einer eigenen, Ruleset-getriebenen Turnier-Engine (Single-/Double-Elimination, Swiss, Round Robin, Multi-Stage) — gebaut, um mehr zu leisten als generische Bracket-Tools wie Challonge, mit Fokus auf die deutschsprachige Community.

## Features (live)

- **Auth**: Passwort, optional E-Mail, Passkeys (WebAuthn/FIDO2), TOTP-2FA, kein Cookie für anonyme Besucher, DSGVO-konformer Elternzustimmungs-Flow für Minderjährige
- **Turniere**: Erstellung, Anmeldung, Check-in, Bracket-Generierung für Single-Elimination, Double-Elimination, Swiss und Round Robin — auch mehrstufig (z. B. Swiss-Vorrunde → Double-Elim-Playoffs) in einem Turnier
- **Offline-Judge-PWA**: Match-Scoring funktioniert ohne Netzwerk (IndexedDB-Queue, idempotenter Sync, Wake-Lock, Daumenzonen-Layout) und synchronisiert automatisch bei Reconnect
- **Regel-Engine**: Punktelogik liest aus einem konfigurierbaren `Ruleset` (kein Hardcoding) — eigene Rulesets anlegbar, inkl. World Beyblade Organization Rules und Blader League Germany Rules
- **Auto-Meta-Engine**: Win-Rate-Auswertung pro Part/Build aus echten, richterbestätigten Matchergebnissen (`/meta`)
- **Sammlung & Decks**: Teile-Katalog, Deckbuilder mit Server-seitiger Duplikatsprüfung, Sammlungsverwaltung mit Mehrwährungsumrechnung (EUR/CHF/USD) und Preisverlauf
- **Social**: Freundschaften, Clubs, Benachrichtigungen (SSE, Redis Pub/Sub), Profil mit granularer Feld-Sichtbarkeit (`PUBLIC` / `FRIENDS_ONLY` / `PRIVATE`)
- **DACH-Eventkalender**: Umkreissuche, Leaflet-Karte (server-seitig gecachte OSM-Tiles), RSS-Feeds pro Land/Bundesland
- **Datenschutz**: Impressum/Datenschutzerklärung/AGB, Art.-16/17/20-Selbstbedienung (Berichtigung, Löschung/Anonymisierung, Datenexport), datensparsame Defaults

## Tech-Stack

Next.js 16 (App Router, Server Actions) · TypeScript · Tailwind CSS v4 (CSS-first, kein `tailwind.config.ts`) · Prisma ORM · PostgreSQL 16 · Redis 7 (Pub/Sub, SSE, Caching) · NextAuth (Credentials + WebAuthn + TOTP) · Leaflet.js · Vitest + Testing Library + Playwright · Docker · Traefik · Watchtower · GitHub Actions → GHCR.

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

## Deployment

Docker-Image → GHCR (`ghcr.io/kernicde/beybladex:latest`), gebaut von GitHub Actions (`deploy.yml`, ausgelöst nach grüner CI), hinter Traefik auf `nicolas@kernic.net`, automatisch aktualisiert durch Watchtower. Details, Topologie und Betriebs-Gotchas: `compose.yml`, `Dockerfile`, sowie die Phase-6-Abschnitte in der [Masterplan-Datei](docs/superpowers/plans/2026-09-08-beybladex-master-plan.md).

## Projektstand & Roadmap

Der vollständige, laufend aktualisierte Implementierungsplan liegt in [`docs/superpowers/plans/2026-09-08-beybladex-master-plan.md`](docs/superpowers/plans/2026-09-08-beybladex-master-plan.md). Kurzfassung:

| Stufe | Umfang | Status |
|---|---|---|
| **MVP1** | Phasen 1–6: Fundament, Design-System, Auth, Regel-Editor, DACH-Kalender & Social, Deck-/Sammlungs-/Turniermanager mit Offline-Judge-UI & Auto-Meta, CI/CD-Pipeline | ✅ **Live** auf beybladex.de |
| **[MVP1.5](https://github.com/KernicDE/beybladex/milestone/1)** | Phasen 7–13: Lücken/Politur am laufenden Betrieb — QR-Workflows & Zahlungsverfolgung, Markdown-Authoring, Standort-Autofill, Profil-/Turnier-/Regelseiten-Tiefe, generische Bild-Upload-Pipeline mit Community-Vorschlagssystem für Sets/Teile & Event-Header-Bilder, Club-Chat, Club-Profilfelder & Beitrittsrichtlinien | 🚧 In Arbeit (2/7 gemerged) |
| **[MVP2](https://github.com/KernicDE/beybladex/milestone/2)** | Phasen 14–20: Ranglisten-System mit Elo-Rating (Saisons, öffentliche Rangliste), Rating-basiertes Bracket-Seeding, Dual-Spin-Part-Modus & Ruleset-getriebene Deckregeln inkl. Turnierstart-Lock-in, eigene visuelle Identität/Branding, echte Push-Benachrichtigungen & Turnier-/Match-Lebenszyklus-Trigger, eindeutige Anzeigenamen & Registrierungs-Klarheit, kanonische Build-Benennung & Duplikatsschutz | 📋 Geplant, nicht gestartet |
| **[MVP3](https://github.com/KernicDE/beybladex/milestone/3)** | 3-vs-3-Team-Wettkampfformat (analog WBO Masters League) | 💭 Noch nicht ausgeplant (Design-Skizze vorhanden) |

Jede Phase in der Masterplan-Datei ist bis auf Datei-/Interface-/Akzeptanzkriterien-Ebene spezifiziert. Fortschritt wird über [GitHub Issues](https://github.com/KernicDE/beybladex/issues) getrackt (ein Issue pro Phase, gruppiert per Milestone/Label `mvp1.5`/`mvp2`/`mvp3`) — nichts aus MVP1.5/MVP2/MVP3 wird ohne explizite Freigabe begonnen.

## Lizenz

Privates Projekt, kein Open-Source-Lizenzmodell definiert.
