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
  // #157 Phase 1: primary CTA text switched to white (the accent is now a saturated
  // red, not a light cyan — base-dark text no longer has enough contrast on it).
  primary: 'bg-x-cyan text-white hover:bg-x-cyan/85',
  // #157 Phase 1 — "Blau bei Hover" gilt für die Navigation/Icon-Controls (Header,
  // MobileNav); secondary/ghost-Buttons bleiben bei der neutralen Grau-Eskalation,
  // damit nicht jede Hover-Fläche der Seite plötzlich blau aufleuchtet.
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

// #157 Phase 3 — "Blade"-Formsprache (Konzept 6): schräg angeschnittene Kanten statt
// rechtwinkliger rounded-Ecken, das Produkt-Motiv aus dem Mockup. rounded-md weicht dafür der
// Clip-Path-Kontur (beides gleichzeitig ergäbe keinen sichtbaren Effekt — der Clip schneidet die
// Rundung ohnehin weg). 8px-Versatz wie im Mockup (Icon-/Standard-Buttons); klein genug, um auch
// bei size="sm" (px-2.5 = 10px Innenabstand) den Text nicht anzuschneiden — visuell auf
// beybladex.de über mehrere Seiten/Breiten geprüft (Login, Bestätigungs-Dialoge, Formulare).
const BLADE_CLIP = '[clip-path:polygon(8px_0,100%_0,calc(100%_-_8px)_100%,0_100%)]'

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', className = '', type = 'button', disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 ${BLADE_CLIP} font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-x-cyan-text disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    />
  )
})
