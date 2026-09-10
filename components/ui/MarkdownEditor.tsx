// components/ui/MarkdownEditor.tsx
// Shared Markdown authoring control for every Markdown-enabled free-text field (Phase 8) —
// replaces the plain Textarea in the six forms editing those fields (profile bio, club/
// ruleset/tournament descriptions, part-request notes, rating comment). Formatting toolbar
// + live preview rendered by the same MarkdownContent the read side uses, so the preview
// is exactly what other users will see.
//
// The character cap counts the MARKDOWN SOURCE length and must equal the server-side cap of
// the edited field — lib/markdownFieldCaps.ts is the single source of truth both sides
// import. The native maxLength attribute is a convenience only; server-side validation in
// each API route stays authoritative (never trust client validation alone).
'use client'

import { useId, useRef, useState, type TextareaHTMLAttributes } from 'react'
import { Bold, Code, Eye, Heading2, Italic, Link2, List, PencilLine, Strikethrough } from 'lucide-react'
import { MarkdownContent } from '@/components/ui/MarkdownContent'
import { Textarea } from '@/components/ui/Textarea'

export interface MarkdownEditorProps
  extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
  value: string
  onChange: (value: string) => void
  invalid?: boolean
}

type Tab = 'write' | 'preview'

// rAF exists in browsers but not in every test environment (jsdom without
// pretendToBeVisual); setTimeout is an equivalent deferral there.
const defer =
  typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function'
    ? (cb: () => void) => window.requestAnimationFrame(() => cb())
    : (cb: () => void) => setTimeout(cb, 0)

export function MarkdownEditor({
  value,
  onChange,
  maxLength,
  rows = 4,
  className = '',
  id,
  'aria-describedby': ariaDescribedby,
  ...rest
}: MarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [tab, setTab] = useState<Tab>('write')
  const counterId = useId()
  const describedby = [ariaDescribedby, counterId].filter(Boolean).join(' ')

  // Selection-mutating toolbar actions. The component is controlled, so mutations go
  // through onChange and the caret is restored after React re-renders the textarea.
  const commit = (next: string, selStart: number, selEnd: number) => {
    onChange(next)
    defer(() => {
      const el = textareaRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(selStart, selEnd)
    })
  }

  const wrapSelection = (before: string, after: string, fallback: string) => {
    const el = textareaRef.current
    if (!el) return
    const { selectionStart: s, selectionEnd: e } = el
    const selected = value.slice(s, e) || fallback
    commit(
      value.slice(0, s) + before + selected + after + value.slice(e),
      s + before.length,
      s + before.length + selected.length,
    )
  }

  const insertLink = () => {
    const el = textareaRef.current
    if (!el) return
    const { selectionStart: s, selectionEnd: e } = el
    const selected = value.slice(s, e) || 'Linktext'
    const url = 'https://'
    const urlStart = s + selected.length + 3 // inside the brackets: `[text](` + url
    commit(
      value.slice(0, s) + `[${selected}](${url})` + value.slice(e),
      urlStart,
      urlStart + url.length,
    )
  }

  const prefixLines = (prefix: string) => {
    const el = textareaRef.current
    if (!el) return
    const lineStart = value.lastIndexOf('\n', el.selectionStart - 1) + 1
    const block = value
      .slice(lineStart, el.selectionEnd)
      .split('\n')
      .map((line) => (line.startsWith(prefix) ? line : prefix + line))
      .join('\n')
    commit(value.slice(0, lineStart) + block + value.slice(el.selectionEnd), lineStart, lineStart + block.length)
  }

  const toolBtn =
    'rounded p-1.5 text-current/70 hover:bg-current/10 hover:text-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-x-cyan-text'
  const tabCls = (active: boolean) =>
    `flex items-center gap-1 rounded-md px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-x-cyan-text ${
      active ? 'bg-current/10 font-medium text-current' : 'text-current/60 hover:text-current'
    }`

  return (
    <div className={className}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <div role="toolbar" aria-label="Markdown-Formatierung" className="flex items-center gap-0.5">
          <button type="button" className={toolBtn} title="Fett" aria-label="Fett" onClick={() => wrapSelection('**', '**', 'fetter Text')}>
            <Bold className="size-4" aria-hidden />
          </button>
          <button type="button" className={toolBtn} title="Kursiv" aria-label="Kursiv" onClick={() => wrapSelection('*', '*', 'kursiver Text')}>
            <Italic className="size-4" aria-hidden />
          </button>
          <button type="button" className={toolBtn} title="Durchgestrichen" aria-label="Durchgestrichen" onClick={() => wrapSelection('~~', '~~', 'durchgestrichen')}>
            <Strikethrough className="size-4" aria-hidden />
          </button>
          <button type="button" className={toolBtn} title="Link" aria-label="Link einfügen" onClick={insertLink}>
            <Link2 className="size-4" aria-hidden />
          </button>
          <button type="button" className={toolBtn} title="Aufzählung" aria-label="Aufzählung" onClick={() => prefixLines('- ')}>
            <List className="size-4" aria-hidden />
          </button>
          <button type="button" className={toolBtn} title="Überschrift" aria-label="Überschrift" onClick={() => prefixLines('## ')}>
            <Heading2 className="size-4" aria-hidden />
          </button>
          <button type="button" className={toolBtn} title="Code" aria-label="Code" onClick={() => wrapSelection('`', '`', 'code')}>
            <Code className="size-4" aria-hidden />
          </button>
        </div>
        <div role="tablist" aria-label="Editor-Ansicht" className="flex items-center gap-1">
          <button type="button" role="tab" aria-selected={tab === 'write'} className={tabCls(tab === 'write')} onClick={() => setTab('write')}>
            <PencilLine className="size-3.5" aria-hidden /> Schreiben
          </button>
          <button type="button" role="tab" aria-selected={tab === 'preview'} className={tabCls(tab === 'preview')} onClick={() => setTab('preview')}>
            <Eye className="size-3.5" aria-hidden /> Vorschau
          </button>
        </div>
      </div>

      {tab === 'write' ? (
        <Textarea
          ref={textareaRef}
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={maxLength}
          rows={rows}
          aria-describedby={describedby || undefined}
          {...rest}
        />
      ) : (
        <div className="min-h-24 rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-base-dark-alt dark:text-zinc-50">
          {value ? (
            <MarkdownContent>{value}</MarkdownContent>
          ) : (
            <p className="text-current/40">Nichts zu sehen — das Feld ist leer.</p>
          )}
        </div>
      )}

      <p id={counterId} aria-live="polite" className="mt-1 text-right text-xs text-current/60">
        {value.length}/{maxLength}
      </p>
    </div>
  )
}
