// components/ui/Select.tsx
// Shared select — compose inside FormField for label/error wiring.
import { forwardRef, type SelectHTMLAttributes } from 'react'

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean
}

const BASE =
  'w-full rounded-md border bg-white px-3 py-2 text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-x-cyan-text dark:bg-base-dark-alt dark:text-zinc-50'

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { invalid = false, className = '', 'aria-invalid': ariaInvalid, children, ...rest },
  ref,
) {
  const border = invalid
    ? 'border-type-attack'
    : 'border-zinc-300 dark:border-zinc-700'
  return (
    <select
      ref={ref}
      aria-invalid={ariaInvalid ?? (invalid ? true : undefined)}
      className={`${BASE} ${border} ${className}`}
      {...rest}
    >
      {children}
    </select>
  )
})
