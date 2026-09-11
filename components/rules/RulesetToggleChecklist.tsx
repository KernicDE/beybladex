// components/rules/RulesetToggleChecklist.tsx (RC10 #72)
// The scanable replacement for the ruleset detail page's "Wall of Text": every boolean
// rule option becomes one compact row — ✓ (active) or ✗ (inactive) icon, the option's
// name, and a WoB badge (green "WoB-Standard" vs. neutral "Abweichung von WoB"). The
// full explanatory paragraph (lib/rulesetProse) is preserved as SECONDARY detail behind
// a native <details> ("Erklärung anzeigen") — nothing is lost, but the first read is a
// checklist, not prose. Server component: no interactivity beyond native <details>.
import { Check, X } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import type { RulesetToggleProse } from '@/lib/rulesetProse'

export function RulesetToggleChecklist({ items }: { items: RulesetToggleProse[] }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.label} className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
              item.value ? 'bg-neon-green/15 text-current' : 'bg-current/10 text-current/50'
            }`}
          >
            {item.value ? <Check size={14} /> : <X size={14} />}
          </span>
          <span className="sr-only">{item.value ? 'Aktiv' : 'Inaktiv'}: </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">{item.label}</p>
              {item.deviates ? (
                <Badge tone="neutral">Abweichung von WoB</Badge>
              ) : (
                <Badge tone="green">WoB-Standard</Badge>
              )}
            </div>
            <details className="mt-1 text-sm text-current/70">
              <summary className="cursor-pointer text-xs text-current/60 transition-colors hover:text-current">
                Erklärung anzeigen
              </summary>
              <p className="mt-1">{item.paragraph}</p>
            </details>
          </div>
        </li>
      ))}
    </ul>
  )
}
