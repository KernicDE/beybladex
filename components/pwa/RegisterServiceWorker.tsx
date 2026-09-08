'use client'

import { useEffect, useState } from 'react'

// Registers the shell service worker and surfaces a non-blocking "update available" toast when a
// new SW is waiting (the SW deliberately never calls self.skipWaiting(), so the user — e.g. a
// judge mid-tournament — keeps the current version until they choose to reload).
export function RegisterServiceWorker() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null)

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
    navigator.serviceWorker.addEventListener('controllerchange', () => setWaitingWorker(null))
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
        onClick={() => window.location.reload()}
      >
        Aktualisieren
      </button>
    </div>
  )
}
