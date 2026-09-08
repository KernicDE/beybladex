// components/ui/Tabs.tsx
// Accessible tabs (ARIA tabs pattern). The active tab's panel is the only one rendered.
'use client'

import { useId, useState, type ReactNode } from 'react'

export interface TabDef {
  id: string
  label: string
  content: ReactNode
}

export function Tabs({ tabs, defaultTab, className = '' }: { tabs: TabDef[]; defaultTab?: string; className?: string }) {
  const baseId = useId()
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.id)

  return (
    <div className={className}>
      <div role="tablist" className="flex gap-1 border-b border-x-cyan/20">
        {tabs.map((tab) => {
          const selected = tab.id === active
          return (
            <button
              key={tab.id}
              role="tab"
              id={`${baseId}-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${tab.id}`}
              onClick={() => setActive(tab.id)}
              className={`rounded-t-md px-4 py-2 text-sm font-medium transition-colors ${
                selected
                  ? 'border-b-2 border-x-cyan-text text-x-cyan-text dark:border-x-cyan dark:text-x-cyan'
                  : 'text-current/60 hover:text-current'
              }`}
            >
              {tab.label}
            </button>
          )
        })}
      </div>
      {tabs.map((tab) =>
        tab.id === active ? (
          <div
            key={tab.id}
            role="tabpanel"
            id={`${baseId}-panel-${tab.id}`}
            aria-labelledby={`${baseId}-tab-${tab.id}`}
            className="pt-4"
          >
            {tab.content}
          </div>
        ) : null,
      )}
    </div>
  )
}
