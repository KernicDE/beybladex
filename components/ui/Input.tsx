// components/ui/Input.tsx
// Shared text input — compose inside FormField for label/error wiring.
import { forwardRef, type InputHTMLAttributes } from 'react'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean
}

const BASE =
  'h-10 w-full rounded-md border bg-white px-3 py-2 text-zinc-900 placeholder:text-current/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-x-cyan-text dark:bg-base-dark-alt dark:text-zinc-50'

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid = false, className = '', 'aria-invalid': ariaInvalid, ...rest },
  ref,
) {
  const border = invalid
    ? 'border-type-attack'
    : 'border-zinc-300 dark:border-zinc-700'
  return (
    <input
      ref={ref}
      aria-invalid={ariaInvalid ?? (invalid ? true : undefined)}
      className={`${BASE} ${border} ${className}`}
      {...rest}
    />
  )
})
