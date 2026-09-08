// components/ui/Toast.tsx
// Minimal toast system: mount <ToastProvider> once near the root, then call
// useToast().push('…') from any client component. Toasts are announced via an
// aria-live region so screen readers pick them up.
'use client'

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

interface ToastItem {
  id: number
  message: string
  tone: 'info' | 'error'
}

interface ToastContextValue {
  push: (message: string, tone?: ToastItem['tone']) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const push = useCallback((message: string, tone: ToastItem['tone'] = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((prev) => [...prev, { id, message, tone }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000)
  }, [])

  const value = useMemo(() => ({ push }), [push])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-16 z-50 flex flex-col items-center gap-2 px-4 md:bottom-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`rounded-md px-4 py-2 text-sm shadow-lg ${
              t.tone === 'error'
                ? 'bg-type-attack text-white'
                : 'bg-base-dark text-base-light dark:bg-base-light dark:text-base-dark'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>')
  return ctx
}
