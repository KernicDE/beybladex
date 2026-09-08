// components/ui/Textarea.tsx
// Shared multiline input — compose inside FormField for label/error wiring.
import { forwardRef, type TextareaHTMLAttributes } from 'react'

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean
}

const BASE =
  'w-full rounded-md border bg-white px-3 py-2 text-zinc-900 placeholder:text-current/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-x-cyan-text dark:bg-base-dark-alt dark:text-zinc-50'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { invalid = false, className = '', 'aria-invalid': ariaInvalid, ...rest },
  ref,
) {
  const border = invalid
    ? 'border-type-attack'
    : 'border-zinc-300 dark:border-zinc-700'
  return (
    <textarea
      ref={ref}
      aria-invalid={ariaInvalid ?? (invalid ? true : undefined)}
      className={`${BASE} ${border} ${className}`}
      {...rest}
    />
  )
})
