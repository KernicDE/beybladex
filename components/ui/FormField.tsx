// components/ui/FormField.tsx
// Label + control + error-text composition. The control's id, aria-invalid and
// aria-describedby (pointing at the error text) are injected via cloneElement, so a
// screen reader announcing the field also announces its error — the association
// can't be forgotten at each call site.
'use client'

import { useId, isValidElement, cloneElement, type ReactElement } from 'react'

export interface FormFieldProps {
  label: string
  error?: string | null
  htmlFor?: string
  children: ReactElement
  className?: string
}

export function FormField({ label, error = null, htmlFor, children, className = '' }: FormFieldProps) {
  const generatedId = useId()
  const controlId = htmlFor ?? generatedId
  const errorId = `${controlId}-error`

  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id: (children.props as { id?: string }).id ?? controlId,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': error ? errorId : undefined,
      })
    : children

  return (
    <div className={className}>
      <label htmlFor={controlId} className="mb-1 block text-sm">
        {label}
      </label>
      {control}
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-sm text-type-attack">
          {error}
        </p>
      )}
    </div>
  )
}
