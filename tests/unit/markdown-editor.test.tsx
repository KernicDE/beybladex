// tests/unit/markdown-editor.test.tsx
// Phase 8: the MarkdownEditor's character-count enforcement must match each Markdown
// field's actual server-side cap. The caps live in lib/markdownFieldCaps.ts — the same
// module the API routes and validation libs (profile, clubs, rulesets, tournaments,
// part-requests, build ratings) import — so asserting the editor renders each cap proves
// client and server limits cannot drift apart.
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { MarkdownEditor } from '@/components/ui/MarkdownEditor'
import { FormField } from '@/components/ui/FormField'
import {
  BIO_MAX,
  CLUB_DESCRIPTION_MAX,
  RULESET_DESCRIPTION_MAX,
  TOURNAMENT_DESCRIPTION_MAX,
  PART_REQUEST_NOTES_MAX,
  RATING_COMMENT_MAX,
} from '@/lib/markdownFieldCaps'

const FIELD_CAPS = [
  ['User.bio', BIO_MAX],
  ['Club.description', CLUB_DESCRIPTION_MAX],
  ['Ruleset.description', RULESET_DESCRIPTION_MAX],
  ['Tournament.description', TOURNAMENT_DESCRIPTION_MAX],
  ['PartRequest.notes', PART_REQUEST_NOTES_MAX],
  ['Rating.comment', RATING_COMMENT_MAX],
] as const

describe('MarkdownEditor field caps', () => {
  it.each(FIELD_CAPS)('enforces the %s server-side cap (%i) as its own maxLength', (_field, cap) => {
    render(<MarkdownEditor value="" onChange={() => {}} maxLength={cap} />)
    // Native cap on the source textarea…
    expect(screen.getByRole('textbox')).toHaveProperty('maxLength', cap)
    // …and the counter counts the Markdown SOURCE length against that same cap.
    expect(screen.getByText(`0/${cap}`)).toBeInTheDocument()
  })

  it('counts Markdown source characters, not rendered/visual length', () => {
    render(<MarkdownEditor value="**x**" onChange={() => {}} maxLength={BIO_MAX} />)
    expect(screen.getByText(`5/${BIO_MAX}`)).toBeInTheDocument()
  })
})

describe('MarkdownEditor behaviour', () => {
  it('keeps FormField label/error wiring intact (id + aria injection)', () => {
    render(
      <FormField label="Über mich" error="Zu lang.">
        <MarkdownEditor value="" onChange={() => {}} maxLength={BIO_MAX} />
      </FormField>,
    )
    const textarea = screen.getByRole('textbox', { name: 'Über mich' })
    expect(textarea).toHaveAttribute('aria-invalid', 'true')
    expect(textarea.getAttribute('aria-describedby')).toContain('-error')
  })

  it('wraps the selection (or fallback text) in the requested Markdown syntax', () => {
    const onChange = vi.fn()
    render(<MarkdownEditor value="" onChange={onChange} maxLength={BIO_MAX} />)
    fireEvent.click(screen.getByRole('button', { name: 'Fett' }))
    expect(onChange).toHaveBeenCalledWith('**fetter Text**')
  })

  it('renders the live preview through MarkdownContent (identical to the read side)', () => {
    const { container } = render(<MarkdownEditor value="**fett**" onChange={() => {}} maxLength={BIO_MAX} />)
    fireEvent.click(screen.getByRole('tab', { name: /Vorschau/ }))
    expect(screen.getByText('fett').tagName).toBe('STRONG')
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(container).toHaveTextContent('fett')
  })
})
