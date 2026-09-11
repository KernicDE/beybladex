// components/judge/JudgeScorePad.tsx
// Phase 5 Part C — the judge scoring UI. MOBILE SPEC ([REVIEW-FIX: frontend-pwa I5], the
// single most user-facing surface of the project):
// - Primary scoring actions (Spin/Over/Burst/Xtreme, match confirm) sit in the bottom ~45% of
//   the viewport — the one-handed thumb zone; the other hand holds the arena/launcher.
// - Spin (scored every round) is the LARGEST target; Xtreme Finish is sized for accuracy
//   despite its rarity (big enough to hit reliably, small enough not to mis-tap as Spin).
// - Every entry has a visible "Rückgängig" affordance for 5 seconds ([REVIEW-FIX: I5]).
// - Match end requires an EXPLICIT confirm step: an action that would reach the target score
//   arms a confirm bar instead of applying — a double-tap can never award double points
//   client-side (the button disables synchronously on press) AND server-side (idempotent
//   clientEventId, /api/matches/[id]/score).
// - Screen Wake Lock keeps the phone awake mid-match ([REVIEW-FIX: I5]); released on unmount
//   and page-hide; guarded for browsers without the API (iOS < 16 etc.).
// - Portrait-primary, large high-contrast tabular numerals (arena lighting glares).
// - A persistent "N Ergebnisse warten auf Sync" indicator reflects the IndexedDB queue depth
//   (lib/offline/matchQueue.ts); scoring works fully offline — every action enqueues a
//   FULL-STATE payload and the four flush triggers deliver it.
// - A reload while offline hydrates from the last IndexedDB snapshot ([REVIEW-FIX: I4]).
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import {
  enqueueScore,
  flushQueue,
  initMatchQueue,
  loadSnapshot,
  saveSnapshot,
  subscribeQueueDepth,
  type MatchScoreState,
} from '@/lib/offline/matchQueue'
import type { PointValues, ScoreEventType } from '@/lib/scoring'

export type PadPlayer = {
  id: string
  name: string
  // Phase 16 — dualSpin/suggestedSpinMode drive the spin-mode picker below: only shown when the
  // CONFIRMED build contains at least one dual-spin part.
  builds: { id: string; label: string; dualSpin: boolean; suggestedSpinMode: 'RIGHT' | 'LEFT' }[]
}

type PadStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED'

type AppliedEntry = { type: ScoreEventType; player: 1 | 2 }

// Screen Wake Lock is in modern TS lib.dom; the guard handles browsers without the API.
function acquireWakeLock(): Promise<WakeLockSentinel> | null {
  return 'wakeLock' in navigator ? navigator.wakeLock.request('screen') : null
}

const SNAPSHOT_KEY = (matchId: string) => `judge:${matchId}`
const UNDO_WINDOW_MS = 5000

export function JudgeScorePad({
  matchId,
  tournamentId,
  roundLabel,
  player1,
  player2,
  initial,
  targetPoints,
  pointValues,
}: {
  matchId: string
  tournamentId: string
  roundLabel: string
  player1: PadPlayer | null
  player2: PadPlayer | null
  initial: {
    scorePlayer1: number
    scorePlayer2: number
    status: PadStatus
    winnerId: string | null
    player1BuildId: string | null
    player2BuildId: string | null
    player1SpinMode: 'RIGHT' | 'LEFT' | null
    player2SpinMode: 'RIGHT' | 'LEFT' | null
  }
  targetPoints: number
  pointValues: PointValues
}) {
  const [score1, setScore1] = useState(initial.scorePlayer1)
  const [score2, setScore2] = useState(initial.scorePlayer2)
  const [status, setStatus] = useState<PadStatus>(initial.status)
  const [winnerId, setWinnerId] = useState<string | null>(initial.winnerId)
  const [build1, setBuild1] = useState<string | null>(initial.player1BuildId)
  const [build2, setBuild2] = useState<string | null>(initial.player2BuildId)
  // Phase 16 — dual-spin mode CONFIRMATION state. null means "not yet explicitly confirmed by
  // the judge" — NEVER preselected from the build's suggestion (a preselected value that the
  // judge simply never touches would submit silently, which is exactly what the WBO's real
  // "submitted for inspection in that mode" step is meant to prevent: an actual tap is
  // required). Once set here (an explicit tap on one of the two mode buttons below), it's
  // locked alongside the build at match start and immutable after (server-enforced 409).
  const [spinMode1, setSpinMode1] = useState<'RIGHT' | 'LEFT' | null>(initial.player1SpinMode)
  const [spinMode2, setSpinMode2] = useState<'RIGHT' | 'LEFT' | null>(initial.player2SpinMode)
  const [pendingConfirm, setPendingConfirm] = useState<{ type: ScoreEventType; player: 1 | 2 } | null>(null)
  const [undoLeftMs, setUndoLeftMs] = useState<number | null>(null)
  const [queueDepth, setQueueDepth] = useState(0)
  const [hydratedOffline, setHydratedOffline] = useState(false)
  const entriesRef = useRef<AppliedEntry[]>([])
  const undoExpiryRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const uuid = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`

  // ---- queue wiring: triggers, depth indicator --------------------------------------------
  useEffect(() => {
    initMatchQueue()
    const unsubscribe = subscribeQueueDepth(setQueueDepth)
    return unsubscribe
  }, [])

  // ---- snapshot hydration ([REVIEW-FIX: frontend-pwa I4]): a reload while offline restores
  // the device's own last-known state from IndexedDB. A snapshot younger than 24 h is treated
  // as the same tournament session and wins over the server render; older snapshots are
  // ignored (stale tournament).
  useEffect(() => {
    let cancelled = false
    void loadSnapshot<{ savedAt: number; state: MatchScoreState }>(SNAPSHOT_KEY(matchId)).then((snap) => {
      if (cancelled || !snap || Date.now() - snap.savedAt > 24 * 3600_000) return
      setScore1(snap.state.scorePlayer1)
      setScore2(snap.state.scorePlayer2)
      setStatus(snap.state.status)
      setWinnerId(snap.state.winnerId ?? null)
      setBuild1(snap.state.player1BuildId ?? null)
      setBuild2(snap.state.player2BuildId ?? null)
      setSpinMode1(snap.state.player1SpinMode ?? null)
      setSpinMode2(snap.state.player2SpinMode ?? null)
      setHydratedOffline(true)
    })
    return () => {
      cancelled = true
    }
  }, [matchId])

  const persistSnapshot = useCallback(
    (state: MatchScoreState) => {
      void saveSnapshot(SNAPSHOT_KEY(matchId), { savedAt: Date.now(), state })
    },
    [matchId]
  )

  // ---- Screen Wake Lock ([REVIEW-FIX: frontend-pwa I5]) ------------------------------------
  useEffect(() => {
    if (!('wakeLock' in navigator)) return // guarded: browsers without the API just miss the feature
    let sentinel: WakeLockSentinel | null = null
    let released = false
    const acquire = () => {
      const pending = acquireWakeLock()
      if (!pending) return
      void pending
        .then((s) => {
          if (released) return void s.release()
          sentinel = s
        })
        .catch(() => {})
    }
    acquire()
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !sentinel) acquire()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      released = true
      document.removeEventListener('visibilitychange', onVisibility)
      void sentinel?.release()
    }
  }, [])

  // ---- scoring core ------------------------------------------------------------------------
  const commit = useCallback(
    (state: MatchScoreState, entry: AppliedEntry | null) => {
      void enqueueScore(matchId, state).then(() => void flushQueue())
      setScore1(state.scorePlayer1)
      setScore2(state.scorePlayer2)
      setStatus(state.status)
      setWinnerId(state.winnerId ?? null)
      if (state.player1BuildId) setBuild1(state.player1BuildId)
      if (state.player2BuildId) setBuild2(state.player2BuildId)
      if (state.player1SpinMode) setSpinMode1(state.player1SpinMode)
      if (state.player2SpinMode) setSpinMode2(state.player2SpinMode)
      if (entry) {
        entriesRef.current = [...entriesRef.current, entry]
        // "Undo last entry" affordance, visible for 5 seconds ([REVIEW-FIX: I5]).
        setUndoLeftMs(5)
        if (undoExpiryRef.current) clearTimeout(undoExpiryRef.current)
        undoExpiryRef.current = setTimeout(() => setUndoLeftMs(null), UNDO_WINDOW_MS)
      }
      persistSnapshot(state)
    },
    [matchId, persistSnapshot]
  )

  const resultingScores = useCallback(
    (type: ScoreEventType, player: 1 | 2, s1: number, s2: number): [number, number] => {
      const pts = pointValues[type] ?? 0
      if (type === 'OWN_FINISH') return player === 1 ? [s1, s2 + pts] : [s1 + pts, s2]
      return player === 1 ? [s1 + pts, s2] : [s1, s2 + pts]
    },
    [pointValues]
  )

  const onScore = useCallback(
    (type: ScoreEventType, player: 1 | 2) => {
      if (status === 'COMPLETED') return
      const [next1, next2] = resultingScores(type, player, score1, score2)
      if (type !== 'EXTERNAL_DISTURBANCE' && type !== 'AERIAL_CONTACT' && (next1 >= targetPoints || next2 >= targetPoints)) {
        // Match-ending action: arm the explicit confirm step instead of applying.
        setPendingConfirm({ type, player })
        return
      }
      commit(
        {
          clientEventId: uuid(),
          event: { type, player },
          scorePlayer1: next1,
          scorePlayer2: next2,
          status: 'IN_PROGRESS',
        },
        type === 'EXTERNAL_DISTURBANCE' || type === 'AERIAL_CONTACT' ? null : { type, player }
      )
    },
    [status, resultingScores, score1, score2, targetPoints, commit]
  )

  const confirmMatchEnd = useCallback(() => {
    if (!pendingConfirm) return
    const { type, player } = pendingConfirm
    setPendingConfirm(null)
    const [next1, next2] = resultingScores(type, player, score1, score2)
    const matchWinner = next1 > next2 ? player1?.id ?? null : player2?.id ?? null
    commit(
      {
        clientEventId: uuid(),
        event: { type, player },
        scorePlayer1: next1,
        scorePlayer2: next2,
        status: 'COMPLETED',
        winnerId: matchWinner,
      },
      { type, player }
    )
  }, [pendingConfirm, resultingScores, score1, score2, player1, player2, commit])
  const undo = useCallback(() => {
    const stack = entriesRef.current
    const last = stack[stack.length - 1]
    if (!last) return
    // Recompute the score without the last event: scores before it are the current scores
    // minus its (Ruleset-derived) point effect.
    const [with1, with2] = resultingScores(last.type, last.player, score1, score2)
    const prev1 = score1 - (with1 - score1)
    const prev2 = score2 - (with2 - score2)
    entriesRef.current = stack.slice(0, -1)
    if (undoExpiryRef.current) clearTimeout(undoExpiryRef.current)
    setUndoLeftMs(null)
    // Undo ships as a full-state write without an event — the score API accepts decreases.
    commit(
      {
        clientEventId: uuid(),
        scorePlayer1: prev1,
        scorePlayer2: prev2,
        status: prev1 >= targetPoints || prev2 >= targetPoints ? 'COMPLETED' : 'IN_PROGRESS',
      },
      null
    )
  }, [score1, score2, resultingScores, targetPoints, commit])

  // Undo countdown: tick the visible seconds; the expiry timer armed in commit hides the bar.
  useEffect(() => {
    if (undoLeftMs === null || undoLeftMs <= 1) return
    const t = setTimeout(() => setUndoLeftMs((v) => (v !== null && v > 1 ? v - 1 : v)), 1000)
    return () => clearTimeout(t)
  }, [undoLeftMs])

  // Phase 16 — the selected build's dual-spin status + suggested mode, derived at render time
  // (no effect needed: this is a pure function of build1/build2 + the player prop). The
  // suggestion is shown as a HINT next to the two mode buttons, never as a preselected value —
  // see spinMode1/spinMode2's own comment on why.
  const effectiveBuild1 = build1 ?? player1?.builds[0]?.id ?? null
  const effectiveBuild2 = build2 ?? player2?.builds[0]?.id ?? null
  const selectedBuild1 = player1?.builds.find((b) => b.id === effectiveBuild1) ?? null
  const selectedBuild2 = player2?.builds.find((b) => b.id === effectiveBuild2) ?? null
  // A dual-spin build whose mode the judge has NOT yet explicitly confirmed blocks match start —
  // "Match starten" stays disabled rather than silently defaulting to the suggestion.
  const spinMode1Unconfirmed = Boolean(selectedBuild1?.dualSpin) && spinMode1 === null
  const spinMode2Unconfirmed = Boolean(selectedBuild2?.dualSpin) && spinMode2 === null

  const startMatch = useCallback(() => {
    commit(
      {
        clientEventId: uuid(),
        scorePlayer1: score1,
        scorePlayer2: score2,
        status: 'IN_PROGRESS',
        player1BuildId: build1 ?? undefined,
        player2BuildId: build2 ?? undefined,
        // Only ever the judge's own explicit tap (spinMode1/2) — never a suggestion fallback.
        player1SpinMode: selectedBuild1?.dualSpin && spinMode1 ? spinMode1 : undefined,
        player2SpinMode: selectedBuild2?.dualSpin && spinMode2 ? spinMode2 : undefined,
      },
      null
    )
  }, [commit, score1, score2, build1, build2, selectedBuild1, selectedBuild2, spinMode1, spinMode2])

  const needsBuilds = status === 'PENDING' && (build1 === null || build2 === null) && (player1 !== null || player2 !== null)
  const name1 = player1?.name ?? 'Spieler 1'
  const name2 = player2?.name ?? 'Spieler 2'
  const leader1 = score1 > score2
  const leader2 = score2 > score1

  const scoreButton = (
    label: string,
    type: ScoreEventType,
    player: 1 | 2,
    className: string,
    ariaLabel: string
  ) => (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={status === 'COMPLETED' || pendingConfirm !== null}
      onClick={() => onScore(type, player)}
      className={`flex touch-manipulation select-none items-center justify-center rounded-xl font-semibold transition-transform active:scale-95 disabled:opacity-40 ${className}`}
    >
      {label}
    </button>
  )

  return (
    <main className="flex min-h-dvh flex-col bg-base-dark text-zinc-50">
      {/* Top bar: context + persistent pending-sync indicator */}
      <header className="flex items-center justify-between gap-2 px-4 pt-3">
        <div className="text-sm text-zinc-400">
          <Link href={`/tournaments/${tournamentId}`} className="hover:underline">
            ← {roundLabel}
          </Link>
          {hydratedOffline && (
            <Badge tone="stamina" className="ml-2">Offline-Stand</Badge>
          )}
        </div>
        <Badge tone={queueDepth > 0 ? 'stamina' : 'neutral'} aria-live="polite">
          {queueDepth > 0 ? `${queueDepth} Ergebnisse warten auf Sync` : 'Sync OK'}
        </Badge>
      </header>

      {/* Live score: large, high-contrast tabular numerals ([REVIEW-FIX: I5] glare rule) */}
      <section aria-label="Spielstand" className="flex flex-1 flex-col items-center justify-center px-4 py-2">
        {status === 'COMPLETED' ? (
          <p className="text-2xl font-bold text-neon-green" aria-live="polite">
            Match beendet — {winnerId === player1?.id ? name1 : name2} gewinnt
          </p>
        ) : (
          <p className="sr-only" aria-live="polite">
            Spielstand {score1} zu {score2}
          </p>
        )}
        <div className="flex w-full max-w-md items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center">
            <span className={`truncate text-sm ${leader1 ? 'font-semibold text-x-cyan' : 'text-zinc-400'}`}>{name1}</span>
            <span className={`text-7xl font-bold tabular-nums ${leader1 ? 'text-x-cyan' : 'text-zinc-100'}`}>
              {score1}
            </span>
          </div>
          <span className="text-4xl font-bold text-zinc-500">:</span>
          <div className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center">
            <span className={`truncate text-sm ${leader2 ? 'font-semibold text-x-cyan' : 'text-zinc-400'}`}>{name2}</span>
            <span className={`text-7xl font-bold tabular-nums ${leader2 ? 'text-x-cyan' : 'text-zinc-100'}`}>
              {score2}
            </span>
          </div>
        </div>
        <p className="mt-1 text-xs text-zinc-500">Ziel: {targetPoints} Punkte</p>
      </section>

      {/* Pre-match build confirmation ([REVIEW-FIX: ux-product §4]): one-tap picker per player,
          defaulting to the deck's first DeckBuild position (preselected from the server). */}
      {needsBuilds && (
        <section aria-label="Match starten" className="space-y-2 px-4 pb-3">
          {player1 && (
            <label className="flex items-center gap-2 text-sm">
              <span className="w-28 truncate">{name1}</span>
              <Select
                aria-label={`Build für ${name1}`}
                value={build1 ?? player1.builds[0]?.id ?? ''}
                onChange={(e) => setBuild1(e.target.value || null)}
                className="flex-1"
              >
                {player1.builds.length === 0 && <option value="">— kein Deck registriert —</option>}
                {player1.builds.map((b) => (
                  <option key={b.id} value={b.id}>{b.label}</option>
                ))}
              </Select>
            </label>
          )}
          {/* Phase 16 items 1-2 — dual-spin mode: only shown when the SELECTED build contains a
              dual-spin part. NEITHER button starts active — the judge must explicitly tap one
              (matches the WBO rule's "submitted for inspection in that mode" step: a real
              confirmation, not a preselected default the judge could just never touch). The
              part's suggested mode is shown as a hint label only. "Match starten" stays
              disabled until every dual-spin build present has an explicit tap. */}
          {player1 && selectedBuild1?.dualSpin && (
            <div className="space-y-1 text-sm">
              <span className="block truncate">
                {name1} Spinrichtung
                {spinMode1 === null && (
                  <span className="ml-2 text-xs text-zinc-400">(Vorschlag: {selectedBuild1.suggestedSpinMode === 'LEFT' ? 'Linksdrehend' : 'Rechtsdrehend'} — bitte bestätigen)</span>
                )}
              </span>
              <div className="flex gap-2" role="group" aria-label={`Spinrichtung für ${name1} bestätigen`}>
                <Button
                  type="button"
                  variant={spinMode1 === 'RIGHT' ? 'primary' : 'secondary'}
                  className="flex-1"
                  onClick={() => setSpinMode1('RIGHT')}
                >
                  Rechtsdrehend
                </Button>
                <Button
                  type="button"
                  variant={spinMode1 === 'LEFT' ? 'primary' : 'secondary'}
                  className="flex-1"
                  onClick={() => setSpinMode1('LEFT')}
                >
                  Linksdrehend
                </Button>
              </div>
            </div>
          )}
          {player2 && (
            <label className="flex items-center gap-2 text-sm">
              <span className="w-28 truncate">{name2}</span>
              <Select
                aria-label={`Build für ${name2}`}
                value={build2 ?? player2.builds[0]?.id ?? ''}
                onChange={(e) => setBuild2(e.target.value || null)}
                className="flex-1"
              >
                {player2.builds.length === 0 && <option value="">— kein Deck registriert —</option>}
                {player2.builds.map((b) => (
                  <option key={b.id} value={b.id}>{b.label}</option>
                ))}
              </Select>
            </label>
          )}
          {player2 && selectedBuild2?.dualSpin && (
            <div className="space-y-1 text-sm">
              <span className="block truncate">
                {name2} Spinrichtung
                {spinMode2 === null && (
                  <span className="ml-2 text-xs text-zinc-400">(Vorschlag: {selectedBuild2.suggestedSpinMode === 'LEFT' ? 'Linksdrehend' : 'Rechtsdrehend'} — bitte bestätigen)</span>
                )}
              </span>
              <div className="flex gap-2" role="group" aria-label={`Spinrichtung für ${name2} bestätigen`}>
                <Button
                  type="button"
                  variant={spinMode2 === 'RIGHT' ? 'primary' : 'secondary'}
                  className="flex-1"
                  onClick={() => setSpinMode2('RIGHT')}
                >
                  Rechtsdrehend
                </Button>
                <Button
                  type="button"
                  variant={spinMode2 === 'LEFT' ? 'primary' : 'secondary'}
                  className="flex-1"
                  onClick={() => setSpinMode2('LEFT')}
                >
                  Linksdrehend
                </Button>
              </div>
            </div>
          )}
          <Button className="w-full" size="lg" onClick={startMatch} disabled={spinMode1Unconfirmed || spinMode2Unconfirmed}>
            Match starten
          </Button>
          {(spinMode1Unconfirmed || spinMode2Unconfirmed) && (
            <p className="text-center text-xs text-zinc-400">Bitte zuerst die Spinrichtung bestätigen.</p>
          )}
        </section>
      )}

      {/* Undo affordance — visible 5 s after every entry, above the thumb zone ([REVIEW-FIX: I5]) */}
      {undoLeftMs !== null && status !== 'COMPLETED' && (
        <div className="flex justify-center px-4 pb-2">
          <Button variant="secondary" size="sm" onClick={undo}>
            Rückgängig ({undoLeftMs}s)
          </Button>
        </div>
      )}

      {/* Match-end confirm: the armed action waits for an explicit tap ([REVIEW-FIX: I5]) */}
      {pendingConfirm && (
        <div role="alertdialog" aria-label="Match beenden" className="space-y-2 border-t border-neon-green/30 bg-neon-green/10 px-4 py-3">
          <p className="text-center text-sm font-medium">
            {pendingConfirm.type.replace('_', ' ')} für {pendingConfirm.player === 1 ? name1 : name2} — Match beenden?
          </p>
          <div className="flex gap-2">
            <Button className="flex-1" size="lg" onClick={confirmMatchEnd}>Bestätigen</Button>
            <Button variant="secondary" className="flex-1" size="lg" onClick={() => setPendingConfirm(null)}>
              Abbrechen
            </Button>
          </div>
        </div>
      )}

      {/* THUMB ZONE (bottom ~45%): primary scoring actions ([REVIEW-FIX: I5]). Spin is the
          largest target (scored every round); Xtreme is sized for accuracy despite rarity. */}
      <section
        aria-label="Wertung"
        className="grid h-[45dvh] min-h-72 grid-cols-2 gap-2 border-t border-x-cyan/20 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      >
        {scoreButton('Spin +1', 'SPIN', 1, 'col-span-2 bg-x-cyan text-xl text-base-dark', `Spin für ${name1}`)}
        {scoreButton(`Over +${pointValues.OVER}`, 'OVER', 1, 'bg-zinc-700 text-base', `Over für ${name1}`)}
        {scoreButton(`Burst +${pointValues.BURST}`, 'BURST', 1, 'bg-zinc-700 text-base', `Burst für ${name1}`)}
        {scoreButton(`Over +${pointValues.OVER}`, 'OVER', 2, 'bg-zinc-700 text-base', `Over für ${name2}`)}
        {scoreButton(`Burst +${pointValues.BURST}`, 'BURST', 2, 'bg-zinc-700 text-base', `Burst für ${name2}`)}
        {scoreButton('Xtreme +3', 'XTREME', 1, 'border-2 border-x-cyan/60 bg-zinc-800 text-base text-x-cyan', `Xtreme Finish für ${name1}`)}
        {scoreButton('Xtreme +3', 'XTREME', 2, 'border-2 border-x-cyan/60 bg-zinc-800 text-base text-x-cyan', `Xtreme Finish für ${name2}`)}
        {/* Rare/destructive actions stay higher and smaller ([REVIEW-FIX: I5]) */}
        <div className="col-span-2 flex gap-2">
          {scoreButton('Out', 'OUT_OF_BOUNDS', 1, 'flex-1 bg-zinc-800 text-xs text-zinc-300', `Out-of-Bounds für ${name1}`)}
          {scoreButton('Out', 'OUT_OF_BOUNDS', 2, 'flex-1 bg-zinc-800 text-xs text-zinc-300', `Out-of-Bounds für ${name2}`)}
          {scoreButton('Störung', 'EXTERNAL_DISTURBANCE', 1, 'flex-1 bg-zinc-800 text-xs text-zinc-400', 'Wiederholung: äußere Störung')}
          {scoreButton('Kontakt', 'AERIAL_CONTACT', 1, 'flex-1 bg-zinc-800 text-xs text-zinc-400', 'Wiederholung: Luftkontakt')}
        </div>
      </section>
    </main>
  )
}
