// components/ui/SearchInput.tsx
// Header search entry point. Submits to /search?q=… — the /search page holds the
// typed result sections, which Phases 3–5 fill with real search backends.
'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'

// useRouter throws outside an App Router context (e.g. unit tests) — fall back to
// a full navigation in that case. Always called, so hook order stays stable.
function useRouterSafe() {
  try {
    return useRouter()
  } catch {
    return null
  }
}

export function SearchInput({ action = '/search', className = '' }: { action?: string; className?: string }) {
  const router = useRouterSafe()
  // Read ?q= straight from the URL — no useSearchParams(), so this works in any
  // context (including unit tests without a router).
  const [value, setValue] = useState(() =>
    typeof window === 'undefined'
      ? ''
      : new URLSearchParams(window.location.search).get('q') ?? '',
  )

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    const q = value.trim()
    const target = q ? `${action}?q=${encodeURIComponent(q)}` : action
    if (router) router.push(target)
    else window.location.assign(target)
  }

  return (
    <form role="search" onSubmit={onSubmit} className={className}>
      <label htmlFor="global-search" className="sr-only">
        Suchen
      </label>
      <input
        id="global-search"
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Suchen…"
        className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder:text-current/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-x-cyan-text dark:border-zinc-700 dark:bg-base-dark-alt dark:text-zinc-50"
      />
    </form>
  )
}
