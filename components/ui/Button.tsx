// components/ui/Button.tsx
// Shared button primitive — every phase's forms and CTAs use this instead of
// hand-rolled <button> markup. Variants map onto the project's Tailwind v4 tokens.
import { forwardRef, type ButtonHTMLAttributes } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

const VARIANTS: Record<Variant, string> = {
  // x-cyan is the BACKGROUND here — the literal accent is fine as a fill; the
  // AA rule (see app/globals.css) only restricts light-mode *text* usage.
  primary: 'bg-x-cyan text-base-dark hover:bg-x-cyan/85',
  secondary:
    'border border-current/30 bg-transparent text-current hover:bg-current/5',
  ghost: 'bg-transparent text-current hover:bg-current/10',
  danger: 'bg-type-attack text-white hover:bg-type-attack/85',
}

const SIZES: Record<Size, string> = {
  sm: 'px-2.5 py-1 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', className = '', type = 'button', disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-x-cyan-text disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    />
  )
})
