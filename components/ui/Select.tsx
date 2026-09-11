// components/ui/Select.tsx
// Shared select — compose inside FormField for label/error wiring.
// RC11 #86: appearance-none + h-10 + an inline chevron. A native <select> carries
// browser-dependent UA metrics (line-height, internal arrow space) and rendered visibly
// taller than the shared Input despite identical padding classes. Normalizing both to an
// explicit h-10 makes them exactly the same height in every browser; the UA dropdown arrow
// is replaced by our own chevron icon.
import { forwardRef, type SelectHTMLAttributes } from 'react'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean
}

const BASE =
  'h-10 w-full appearance-none rounded-md border bg-white pl-3 pr-8 text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-x-cyan-text dark:bg-base-dark-alt dark:text-zinc-50'

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid = false, className = '', 'aria-invalid': ariaInvalid, children, ...rest },
  ref,
) {
  const border = invalid
    ? 'border-type-attack'
    : 'border-zinc-300 dark:border-zinc-700'
  return (
    <div className="relative">
      <select
        ref={ref}
        aria-invalid={ariaInvalid ?? (invalid ? true : undefined)}
        className={`${BASE} ${border} ${className}`}
        {...rest}
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        fill="none"
        className="pointer-events-none absolute inset-y-0 right-2 my-auto size-4 text-zinc-500 dark:text-zinc-400"
      >
        <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  )
})
