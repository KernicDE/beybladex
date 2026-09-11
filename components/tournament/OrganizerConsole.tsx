// components/tournament/OrganizerConsole.tsx
// Phase 5 Part C — the operator surface for running a tournament ([REVIEW-FIX: ux-product §3f]:
// Match.status/round/bracketOrder existed with no operator UI at all); Phase 5 Part C2 — the
// single "Bracket generieren" action became a STAGE LIST: create stage → generate/pair the
// current round → complete the stage → repeat for the next stage. Visible ONLY to the
// tournament's creator or an ADMIN (enforced server-side on every action; the page additionally
// gates rendering). Actions per stage: Bracket/Runde generieren (format-dispatched server-side),
// Stage abschließen, Judge zuweisen per match, no-show handling, Turnier abschließen.
'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { Card, CardTitle } from '@/components/ui/Card'
import { HeaderImageUpload } from '@/components/tournament/HeaderImageUpload'
import { SeedingPanel } from '@/components/tournament/SeedingPanel'

export type ConsoleParticipant = { userId: string; name: string; checkedIn: boolean; withdrawn: boolean; paidAt: string | null; seed: number | null }
export type ConsoleMatch = {
  id: string
  stageId: string
  round: number
  label: string
  player1: string | null
  player2: string | null
  status: string
  judgeId: string | null
}
export type ConsoleStanding = { userId: string; name: string; wins: number; losses: number; buchholz: number }
export type ConsoleStage = {
  id: string
  order: number
  name: string
  format: 'SINGLE_ELIMINATION' | 'DOUBLE_ELIMINATION' | 'SWISS' | 'ROUND_ROBIN'
  status: 'PENDING' | 'ACTIVE' | 'COMPLETED'
  swissRounds: number | null
  swissRoundsDone: number
  qualifyCount: number | null
  matches: ConsoleMatch[]
  standings: ConsoleStanding[]
}
export type ConsoleJudge = { id: string; name: string }

const FORMAT_LABEL: Record<ConsoleStage['format'], string> = {
  SINGLE_ELIMINATION: 'Single Elimination',
  DOUBLE_ELIMINATION: 'Double Elimination',
  SWISS: 'Swiss',
  ROUND_ROBIN: 'Round Robin',
}

export function OrganizerConsole({
  tournamentId,
  participants,
  stages,
  judges,
  completedAt,
  startedAt,
  tournamentJudges,
  entryFeeCent,
  headerImageId,
}: {
  tournamentId: string
  participants: ConsoleParticipant[]
  stages: ConsoleStage[]
  judges: ConsoleJudge[]
  completedAt: string | null
  /** Phase 16 item 6 — "Turnier starten": one-way, distinct from completedAt and NOT inferred
   *  from startDate. Once set, a locked-decks ruleset's participants have their build
   *  selection snapshotted (TournamentParticipant.lockedBuildIds). */
  startedAt: string | null
  /** Phase 7 — users granted per-tournament check-in/arena/payment staff authority. */
  tournamentJudges: ConsoleJudge[]
  /** Phase 7 — the payment section only renders when the event actually charges an entry fee. */
  entryFeeCent: number
  /** Phase 11 (item 5) — current header image, if any, for the upload section's preview. */
  headerImageId: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Create-stage form state.
  const [stageName, setStageName] = useState('')
  const [stageFormat, setStageFormat] = useState<ConsoleStage['format']>('SINGLE_ELIMINATION')
  const [stageSwissRounds, setStageSwissRounds] = useState(3)
  const [stageRoundRobinRepeats, setStageRoundRobinRepeats] = useState(1)
  const [stageQualifyCount, setStageQualifyCount] = useState('')
  const [newJudgeId, setNewJudgeId] = useState('')
  const [arenaCount, setArenaCount] = useState('')

  const base = `/api/tournaments/${tournamentId}`
  const call = async (fn: () => Promise<Response>) => {
    setBusy(true)
    setError(null)
    try {
      const res = await fn()
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? `Fehler (${res.status})`)
      } else {
        router.refresh()
      }
    } catch {
      setError('Netzwerkfehler — bitte erneut versuchen.')
    } finally {
      setBusy(false)
    }
  }

  const checkedIn = participants.filter((p) => p.checkedIn && !p.withdrawn)
  const completed = completedAt !== null
  const allMatches = stages.flatMap((s) => s.matches)
  const openMatches = allMatches.filter((m) => m.status !== 'COMPLETED')
  const bracketGenerated = allMatches.length > 0

  const createStage = () =>
    call(
      () =>
        fetch(`${base}/stages`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            name: stageName,
            format: stageFormat,
            ...(stageFormat === 'SWISS' ? { swissRounds: stageSwissRounds } : {}),
            ...(stageFormat === 'ROUND_ROBIN' ? { roundRobinRepeats: stageRoundRobinRepeats } : {}),
            ...(stageQualifyCount !== '' ? { qualifyCount: Number(stageQualifyCount) } : {}),
            ...(arenaCount !== '' ? { arenaCount: Number(arenaCount) } : {}),
          }),
        }),
    )

  // RC11 #82 — the console is split into separately headed Cards (Vorbereitung / Stages &
  // Matches / Zahlungen / Staff / Abschluss) instead of one ~590-line block, so each
  // functional area is scannable during a live tournament. Pure layout change: every action,
  // gate and data flow below is untouched.
  return (
    <div className="space-y-4">
      <Card className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Organisatoren-Konsole</CardTitle>
          {completed && <Badge tone="green">Turnier abgeschlossen</Badge>}
        </div>
        {error && <p role="alert" className="text-sm text-type-attack">{error}</p>}

        {/* Phase 10 item 2 — closes the gap where PATCH/DELETE /api/tournaments/[id] had no UI
            caller anywhere. "Absagen" only makes sense before the bracket exists — once matches
            are generated, DELETE would silently wipe live results, so it's hidden after that
            point (organizers use "Turnier abschließen" instead, further below). */}
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/tournaments/${tournamentId}/edit`}
            className="inline-block rounded-md border border-current/30 px-4 py-2 text-sm font-medium transition-colors hover:bg-current/5"
          >
            Turnier bearbeiten
          </Link>
          {/* Phase 16 item 6 — one-way; sets Tournament.startedAt and, for a locked-decks
              ruleset, snapshots every participant's current deck builds. Typically pressed
              before "Bracket generieren" for the first stage, but not enforced in either order. */}
          {!startedAt && !completed && (
            <Button
              disabled={busy}
              onClick={() => {
                if (window.confirm('Turnier starten? Dies kann nicht rückgängig gemacht werden — bei einem Regelwerk mit gesperrten Decks werden alle angemeldeten Decks jetzt eingefroren.')) {
                  void call(() => fetch(`${base}/start`, { method: 'POST' }))
                }
              }}
            >
              Turnier starten
            </Button>
          )}
          {startedAt && <Badge tone="cyan">Gestartet</Badge>}
          {!bracketGenerated && !completed && !startedAt && (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                if (window.confirm('Turnier absagen? Alle Anmeldungen werden entfernt. Dies kann nicht rückgängig gemacht werden.')) {
                  setBusy(true)
                  setError(null)
                  fetch(base, { method: 'DELETE' })
                    .then((res) => {
                      if (res.ok) {
                        router.push('/events')
                        router.refresh()
                      } else {
                        setBusy(false)
                        setError(`Fehler (${res.status})`)
                      }
                    })
                    .catch(() => {
                      setBusy(false)
                      setError('Netzwerkfehler — bitte erneut versuchen.')
                    })
                }
              }}
            >
              Turnier absagen
            </Button>
          )}
        </div>

        <HeaderImageUpload tournamentId={tournamentId} headerImageId={headerImageId} />

        {/* Phase 15 — seeding only makes sense pre-bracket (it's read once at generation time);
            hidden once the first stage has matches, same gating as "Stage hinzufügen" above. */}
        {!bracketGenerated && !completed && participants.length > 0 && (
          <SeedingPanel
            tournamentId={tournamentId}
            participants={participants.filter((p) => !p.withdrawn).map((p) => ({ userId: p.userId, name: p.name, seed: p.seed }))}
          />
        )}

        {!completed && (
          <section aria-labelledby="stage-create-heading" className="space-y-2">
            <h3 id="stage-create-heading" className="text-sm font-semibold">Stage hinzufügen</h3>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-current/60">
                Name
                <input
                  value={stageName}
                  onChange={(e) => setStageName(e.target.value)}
                  placeholder="z.B. Vorrunde"
                  className="mt-1 block w-36 rounded-md border border-current/20 bg-transparent px-2 py-1.5 text-sm text-current"
                />
              </label>
              <label className="text-xs text-current/60">
                Format
                <Select value={stageFormat} onChange={(e) => setStageFormat(e.target.value as ConsoleStage['format'])} className="mt-1 block w-44">
                  <option value="SINGLE_ELIMINATION">Single Elimination</option>
                  <option value="DOUBLE_ELIMINATION">Double Elimination</option>
                  <option value="SWISS">Swiss</option>
                  <option value="ROUND_ROBIN">Round Robin</option>
                </Select>
              </label>
              {stageFormat === 'SWISS' && (
                <label className="text-xs text-current/60">
                  Runden
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={stageSwissRounds}
                    onChange={(e) => setStageSwissRounds(Number(e.target.value))}
                    className="mt-1 block w-20 rounded-md border border-current/20 bg-transparent px-2 py-1.5 text-sm text-current"
                  />
                </label>
              )}
              {stageFormat === 'ROUND_ROBIN' && (
                <label className="text-xs text-current/60">
                  Wiederholungen
                  <input
                    type="number"
                    min={1}
                    max={3}
                    value={stageRoundRobinRepeats}
                    onChange={(e) => setStageRoundRobinRepeats(Number(e.target.value))}
                    className="mt-1 block w-20 rounded-md border border-current/20 bg-transparent px-2 py-1.5 text-sm text-current"
                  />
                </label>
              )}
              <label className="text-xs text-current/60">
                Qualifikanten (optional)
                <input
                  type="number"
                  min={1}
                  value={stageQualifyCount}
                  onChange={(e) => setStageQualifyCount(e.target.value)}
                  placeholder="—"
                  className="mt-1 block w-20 rounded-md border border-current/20 bg-transparent px-2 py-1.5 text-sm text-current"
                />
              </label>
              <label className="text-xs text-current/60">
                Arenen (optional)
                <input
                  type="number"
                  min={1}
                  max={64}
                  value={arenaCount}
                  onChange={(e) => setArenaCount(e.target.value)}
                  placeholder="—"
                  className="mt-1 block w-20 rounded-md border border-current/20 bg-transparent px-2 py-1.5 text-sm text-current"
                />
              </label>
              <Button disabled={busy || stageName.trim().length === 0} onClick={() => void createStage()}>
                Stage erstellen
              </Button>
            </div>
            <p className="text-xs text-current/50">
              Die erste Stage (Reihenfolge 1) startet mit allen eingecheckten Teilnehmern; jede
              weitere Stage startet mit den Qualifikanten der vorherigen Stage. Arenen: Anzahl der
              physisch verfügbaren Stadien — Matches werden automatisch zugewiesen, sobald eine
              Arena frei wird.
            </p>
          </section>
        )}

        {openMatches.length === 0 && stages.length === 0 && !completed && (
          <p className="text-sm text-current/60">
            Noch keine Stage. Lege oben die erste Stage an (z.B. Vorrunde), sobald die Anmeldung
            geschlossen ist.
          </p>
        )}
      </Card>

      {stages.length > 0 && (
        <Card className="space-y-4 p-4">
          <CardTitle>Stages &amp; Matches</CardTitle>
          {stages.map((stage) => {
            const stageComplete = stage.status === 'COMPLETED'
            const allDone = stage.matches.length > 0 && stage.matches.every((m) => m.status === 'COMPLETED')
            const minPlayers = stage.format === 'DOUBLE_ELIMINATION' ? 3 : 2
            const swissDone = stage.swissRounds !== null && stage.swissRoundsDone >= stage.swissRounds
            return (
              <section key={stage.id} aria-labelledby={`stage-${stage.id}`} className="space-y-2 rounded-lg border border-current/10 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 id={`stage-${stage.id}`} className="text-sm font-semibold">
                    {stage.order}. {stage.name}
                  </h3>
                  <Badge tone="cyan">{FORMAT_LABEL[stage.format]}</Badge>
                  {stageComplete && <Badge tone="green">Abgeschlossen</Badge>}
                  {stage.format === 'SWISS' && stage.swissRounds !== null && (
                    <span className="text-xs text-current/50">
                      Runde {stage.swissRoundsDone}/{stage.swissRounds}
                    </span>
                  )}
                  {stage.qualifyCount !== null && (
                    <span className="text-xs text-current/50">Top {stage.qualifyCount} qualifiziert</span>
                  )}
                </div>

                {!stageComplete && stage.format !== 'SWISS' && stage.matches.length === 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      disabled={busy || checkedIn.length < minPlayers}
                      onClick={() => call(() => fetch(`${base}/stages/${stage.id}/generate`, { method: 'POST' }))}
                    >
                      {/* Distinct copy per format (plan convention): Round Robin generates the whole
                          fixture list in one shot — "Spielplan", not "Bracket". */}
                      {stage.format === 'ROUND_ROBIN' ? 'Spielplan erstellen' : 'Bracket generieren'}
                    </Button>
                    {checkedIn.length < minPlayers && (
                      <p className="text-xs text-current/50">Mindestens {minPlayers} eingecheckte Teilnehmer nötig.</p>
                    )}
                  </div>
                )}

                {!stageComplete && stage.format === 'SWISS' && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      disabled={busy || swissDone}
                      onClick={() => call(() => fetch(`${base}/stages/${stage.id}/generate`, { method: 'POST' }))}
                    >
                      Runde {Math.min(stage.swissRoundsDone + 1, stage.swissRounds ?? 0)} pairen
                    </Button>
                    {swissDone && <span className="text-xs text-current/50">Alle geplanten Runden gepaart.</span>}
                  </div>
                )}

                {!stageComplete && allDone && (
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Stage „${stage.name}" abschließen?`)) {
                        void call(() => fetch(`${base}/stages/${stage.id}/complete`, { method: 'POST' }))
                      }
                    }}
                  >
                    Stage abschließen
                  </Button>
                )}

                {(stage.format === 'SWISS' || stage.format === 'ROUND_ROBIN') && stage.standings.length > 0 && (
                  <table className="w-full text-sm">
                    <caption className="sr-only">Tabelle {stage.name}</caption>
                    <thead>
                      <tr className="text-left text-current/60">
                        <th scope="col" className="py-1 pr-2 font-medium">#</th>
                        <th scope="col" className="py-1 pr-2 font-medium">Spieler</th>
                        <th scope="col" className="py-1 pr-2 text-right font-medium">S</th>
                        <th scope="col" className="py-1 pr-2 text-right font-medium">N</th>
                        <th scope="col" className="py-1 text-right font-medium">Buchholz</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stage.standings.map((s, i) => (
                        <tr key={s.userId} className="border-t border-current/10">
                          <td className="py-1.5 pr-2 text-current/60">{i + 1}</td>
                          <td className="py-1.5 pr-2">{s.name}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{s.wins}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{s.losses}</td>
                          <td className="py-1.5 text-right tabular-nums">{s.buchholz}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {bracketGenerated && !completed && (
                  <section aria-labelledby="judge-assign-heading" className="space-y-2">
                    <h4 id="judge-assign-heading" className="text-sm font-semibold">
                      Judge zuweisen — {stage.name} ({stage.matches.filter((m) => m.status !== 'COMPLETED').length} offene Matches)
                    </h4>
                    <ul className="space-y-2">
                      {stage.matches.map((m) => (
                        <li key={m.id} className="flex flex-wrap items-center gap-2 rounded-md border border-current/10 px-3 py-2 text-sm">
                          <span className="min-w-40 flex-1">
                            <span className="text-current/50">{m.label}: </span>
                            {m.player1 ?? 'Offen'} vs. {m.player2 ?? 'Offen'}
                          </span>
                          <Select
                            aria-label={`Judge für ${m.player1 ?? 'Offen'} vs. ${m.player2 ?? 'Offen'}`}
                            defaultValue={m.judgeId ?? ''}
                            disabled={busy || m.status === 'COMPLETED'}
                            className="w-44"
                            onChange={(e) => {
                              const judgeId = e.target.value || null
                              void call(() =>
                                fetch(`${base}/matches/${m.id}/judge`, {
                                  method: 'PATCH',
                                  headers: { 'content-type': 'application/json' },
                                  body: JSON.stringify({ judgeId }),
                                })
                              )
                            }}
                          >
                            <option value="">— kein Judge —</option>
                            {judges.map((j) => (
                              <option key={j.id} value={j.id}>
                                {j.name}
                              </option>
                            ))}
                          </Select>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}
              </section>
            )
        })}
        </Card>
      )}

      {entryFeeCent > 0 && (
        <Card className="space-y-4 p-4">
          <section aria-labelledby="payment-heading" className="space-y-2">
            <h3 id="payment-heading" className="text-sm font-semibold">
              Zahlungsverfolgung
            </h3>
            <ul className="space-y-1">
              {participants
                .filter((p) => !p.withdrawn)
                .map((p) => (
                  <li key={p.userId} className="flex items-center justify-between gap-2 text-sm">
                    <span>
                      {p.name}
                      {p.paidAt && (
                        <span className="ml-2 text-xs text-current/50">
                          bezahlt am {new Date(p.paidAt).toLocaleDateString('de-DE')}
                        </span>
                      )}
                    </span>
                    <Button
                      variant={p.paidAt ? 'secondary' : 'primary'}
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void call(() =>
                          fetch(`/api/tournaments/${tournamentId}/participants/${p.userId}/paid`, {
                            method: p.paidAt ? 'DELETE' : 'PATCH',
                          }),
                        )
                      }
                    >
                      {p.paidAt ? 'Als unbezahlt markieren' : 'Als bezahlt markieren'}
                    </Button>
                  </li>
                ))}
            </ul>
            {participants.filter((p) => !p.withdrawn && p.paidAt).length < participants.filter((p) => !p.withdrawn).length && (
              <p className="text-xs text-current/50">
                {participants.filter((p) => !p.withdrawn && p.paidAt).length} von{' '}
                {participants.filter((p) => !p.withdrawn).length} bezahlt
              </p>
            )}
          </section>
        </Card>
      )}

      <Card className="space-y-4 p-4">
        <section aria-labelledby="staff-heading" className="space-y-2">
          <h3 id="staff-heading" className="text-sm font-semibold">
            Turnier-Staff (Check-in, Arena, Zahlung)
          </h3>
          <p className="text-xs text-current/50">
            Zusätzlich zu dir dürfen diese Judges Teilnehmer:innen einchecken, Arena-Check-ins
            bestätigen und Zahlungen erfassen.
          </p>
          <ul className="space-y-1">
            {tournamentJudges.map((j) => (
              <li key={j.id} className="flex items-center justify-between gap-2 text-sm">
                <span>{j.name}</span>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void call(
                      () => fetch(`/api/tournaments/${tournamentId}/judges?userId=${j.id}`, { method: 'DELETE' }),
                    )
                  }
                >
                  Entfernen
                </Button>
              </li>
            ))}
          </ul>
          {judges.length > 0 && (
            <div className="flex items-center gap-2">
              <Select value={newJudgeId} onChange={(e) => setNewJudgeId(e.target.value)} className="max-w-xs">
                <option value="">Judge auswählen…</option>
                {judges
                  .filter((j) => !tournamentJudges.some((tj) => tj.id === j.id))
                  .map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.name}
                    </option>
                  ))}
              </Select>
              <Button
                size="sm"
                disabled={busy || !newJudgeId}
                onClick={() => {
                  const id = newJudgeId
                  setNewJudgeId('')
                  void call(
                    () =>
                      fetch(`/api/tournaments/${tournamentId}/judges`, {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ userId: id }),
                      }),
                  )
                }}
              >
                Hinzufügen
              </Button>
            </div>
          )}
        </section>
      </Card>

      {bracketGenerated && !completed && (
        <Card className="space-y-4 p-4">
          <CardTitle>Turnier abschließen</CardTitle>
          <section aria-labelledby="noshow-heading" className="space-y-2">
            <h3 id="noshow-heading" className="text-sm font-semibold">
              Nicht erschienen (No-Show)
            </h3>
            <ul className="space-y-1">
              {checkedIn.map((p) => (
                <li key={p.userId} className="flex items-center justify-between gap-2 text-sm">
                  <span>{p.name}</span>
                  <Button
                    variant="danger"
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`${p.name} als nicht erschienen markieren? Der Gegner wird automatisch weitergebracht.`)) {
                        void call(() =>
                          fetch(`${base}/noshow`, {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ userId: p.userId }),
                          })
                        )
                      }
                    }}
                  >
                    No-Show
                  </Button>
                </li>
              ))}
            </ul>
          </section>

          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => {
              if (window.confirm('Turnier abschließen? Dies kann nicht rückgängig gemacht werden.')) {
                void call(() => fetch(`${base}/complete`, { method: 'POST' }))
              }
            }}
          >
            Turnier abschließen
          </Button>
        </Card>
      )}
    </div>
  )
}
