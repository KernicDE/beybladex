'use client'

import { useEffect, useState } from 'react'

const DISMISSED_KEY = 'beybladex-install-prompt-dismissed'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  return /iP(hone|ad|od)/.test(ua) && !/(CriOS|FxiOS|EdgiOS|OPiOS)/.test(ua)
}

// Shows a PWA install CTA. Chromium fires beforeinstallprompt; iOS Safari never does, so there we
// show a one-time informational card explaining "Teilen → Zum Home-Bildschirm" instead.
export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [showIOSCard, setShowIOSCard] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (localStorage.getItem(DISMISSED_KEY)) {
      setDismissed(true)
      return
    }

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setDeferredPrompt(event as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)

    if (isIOS() && !window.matchMedia('(display-mode: standalone)').matches) {
      setShowIOSCard(true)
    }

    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
  }, [])

  if (dismissed || (!deferredPrompt && !showIOSCard)) return null

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, Date.now().toString(36))
    setDismissed(true)
  }

  const install = async () => {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    await deferredPrompt.userChoice
    setDeferredPrompt(null)
  }

  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-50 max-w-xs rounded-lg border border-x-cyan/40 bg-base-dark/95 p-4 text-sm text-slate-100 shadow-lg"
    >
      {deferredPrompt ? (
        <>
          <p className="mb-3">BeybladeX.de als App installieren?</p>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded bg-x-cyan px-3 py-1 font-medium text-base-dark"
              onClick={install}
            >
              Installieren
            </button>
            <button type="button" className="rounded border border-slate-600 px-3 py-1" onClick={dismiss}>
              Später
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="mb-3">
            Zum Home-Bildschirm hinzufügen: Teilen-Menü öffnen und &quot;Zum Home-Bildschirm&quot;
            wählen.
          </p>
          <button type="button" className="rounded border border-slate-600 px-3 py-1" onClick={dismiss}>
            Verstanden
          </button>
        </>
      )}
    </div>
  )
}
