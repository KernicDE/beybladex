// components/settings/PushSubscribeButton.tsx (Phase 18 item 1)
// Client-side Push subscribe/unsubscribe control. Requires the service worker (already
// registered by components/pwa/RegisterServiceWorker.tsx) and the Notification/PushManager
// browser APIs — both guarded, so an unsupported browser (or NEXT_PUBLIC_VAPID_PUBLIC_KEY unset
// at build time — see Dockerfile's own comment) just doesn't render the control at all rather
// than showing a broken button.
'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/Button'

function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  // Explicit ArrayBuffer-backed Uint8Array — TS's DOM lib types PushManager.subscribe's
  // applicationServerKey as BufferSource, and a plain Uint8Array.from(...) result's buffer type
  // (ArrayBufferLike, which also covers SharedArrayBuffer) doesn't structurally satisfy it.
  const bytes = new Uint8Array(new ArrayBuffer(rawData.length))
  for (let i = 0; i < rawData.length; i++) bytes[i] = rawData.charCodeAt(i)
  return bytes
}

type Status = 'checking' | 'unsupported' | 'subscribed' | 'unsubscribed' | 'denied'

export function PushSubscribeButton() {
  const [status, setStatus] = useState<Status>('checking')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY

  useEffect(() => {
    let cancelled = false
    async function check() {
      if (!vapidPublicKey || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        if (!cancelled) setStatus('unsupported')
        return
      }
      if (Notification.permission === 'denied') {
        if (!cancelled) setStatus('denied')
        return
      }
      const registration = await navigator.serviceWorker.ready
      const existing = await registration.pushManager.getSubscription()
      if (!cancelled) setStatus(existing ? 'subscribed' : 'unsubscribed')
    }
    void check()
    return () => {
      cancelled = true
    }
  }, [vapidPublicKey])

  async function subscribe() {
    setPending(true)
    setError(null)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'denied' : 'unsubscribed')
        return
      }
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey!),
      })
      const json = subscription.toJSON()
      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      })
      if (!res.ok) throw new Error('subscribe_failed')
      setStatus('subscribed')
    } catch {
      setError('Push-Aktivierung fehlgeschlagen — bitte erneut versuchen.')
    } finally {
      setPending(false)
    }
  }

  async function unsubscribe() {
    setPending(true)
    setError(null)
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        const endpoint = subscription.endpoint
        await subscription.unsubscribe()
        await fetch('/api/push/unsubscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint }),
        })
      }
      setStatus('unsubscribed')
    } catch {
      setError('Deaktivierung fehlgeschlagen — bitte erneut versuchen.')
    } finally {
      setPending(false)
    }
  }

  if (status === 'checking') return null
  if (status === 'unsupported') {
    return <p className="text-xs text-zinc-500 dark:text-zinc-400">Push-Benachrichtigungen werden von diesem Browser/Gerät nicht unterstützt.</p>
  }
  if (status === 'denied') {
    return <p className="text-xs text-zinc-500 dark:text-zinc-400">Push-Benachrichtigungen sind in den Browser-Einstellungen blockiert — dort erst wieder erlauben.</p>
  }

  return (
    <div className="space-y-2">
      <Button type="button" variant="secondary" size="sm" disabled={pending} onClick={status === 'subscribed' ? unsubscribe : subscribe}>
        {pending ? 'Bitte warten…' : status === 'subscribed' ? 'Push-Benachrichtigungen deaktivieren (dieses Gerät)' : 'Push-Benachrichtigungen für dieses Gerät aktivieren'}
      </Button>
      {error && <p role="alert" className="text-xs text-type-attack">{error}</p>}
    </div>
  )
}
