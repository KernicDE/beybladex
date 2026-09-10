'use client'

import { useEffect, useRef, useState } from 'react'

// Registers the shell service worker and surfaces a non-blocking "update available" toast when a
// new SW is waiting. The SW deliberately never calls self.skipWaiting() on its own, so the user —
// e.g. a judge mid-tournament — keeps the current version until they choose to update. The toast's
// "Aktualisieren" button messages the waiting worker (SKIP_WAITING); the page reloads only once
// the new worker has actually taken control (controllerchange), never from a bare reload() that
// would just re-serve the old SW.
export function RegisterServiceWorker() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null)
  // Set by the button click, read by the controllerchange listener: only an explicit user-
  // triggered update may reload the page — other controllerchange events (e.g. first registration
  // taking control) must not.
  const updateRequestedRef = useRef(false)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    navigator.serviceWorker.register('/sw.js').then((registration) => {
      if (registration.waiting) setWaitingWorker(registration.waiting)

      registration.addEventListener('updatefound', () => {
        const worker = registration.installing
        if (!worker) return
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            setWaitingWorker(worker)
          }
        })
      })
    })

    // A waiting worker may have appeared while this page was open (e.g. after a redeploy).
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      setWaitingWorker(null)
      if (updateRequestedRef.current) window.location.reload()
    })
  }, [])

  if (!waitingWorker) return null

  return (
    <div
      role="status"
      className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-x-cyan/40 bg-base-dark/95 px-4 py-3 text-sm text-slate-100 shadow-lg"
    >
      <span>Neue Version verfügbar.</span>
      <button
        type="button"
        className="rounded bg-x-cyan px-3 py-1 font-medium text-base-dark"
        onClick={() => {
          if (!waitingWorker) return
          updateRequestedRef.current = true
          waitingWorker.postMessage({ type: 'SKIP_WAITING' })
        }}
      >
        Aktualisieren
      </button>
    </div>
  )
}
