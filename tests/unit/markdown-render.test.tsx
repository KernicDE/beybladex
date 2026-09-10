// tests/unit/markdown-render.test.tsx
// Phase 8 security + correctness proof for the shared Markdown renderer (components/ui/
// MarkdownContent.tsx). The core requirement: attacker-controlled HTML inside user free
// text (e.g. a Rating.comment, writable by any registered user) can never execute — there
// is deliberately no rehype-raw / raw-HTML pass-through, so embedded markup renders as
// inert literal text at most. Also proves the GFM surface (tables, strikethrough) and the
// link-rel override the phase spec mandates.
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MarkdownContent } from '@/components/ui/MarkdownContent'

describe('MarkdownContent', () => {
  it('renders an embedded <script> as inert literal text, never as a script element', () => {
    const { container } = render(
      <MarkdownContent>{'Mein Kommentar: <script>alert(1)</script> Ende'}</MarkdownContent>,
    )
    // No script element exists in the output and no script tag survives in any form.
    expect(container.querySelector('script')).toBeNull()
    expect(container.innerHTML).not.toContain('<script')
    // The payload is inert text content — visible, but unable to execute.
    expect(container.textContent).toContain('alert(1)')
    expect(container.textContent).toContain('Mein Kommentar')
  })

  it('renders event-handler HTML attributes as inert text, not as DOM attributes', () => {
    const { container } = render(<MarkdownContent>{'<img src=x onerror=alert(1)>'}</MarkdownContent>)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('[onerror]')).toBeNull()
    // The payload survives only as escaped literal text — never as markup/attributes.
    expect(container.innerHTML).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })

  it('does not produce a javascript: link href', () => {
    const { container } = render(<MarkdownContent>{'[klick](javascript:alert(1))'}</MarkdownContent>)
    const anchor = container.querySelector('a')
    expect(anchor).not.toBeNull()
    expect(anchor!.getAttribute('href') ?? '').not.toContain('javascript:')
  })

  it('renders **bold** as strong and [link](url) with the mandated rel override', () => {
    render(<MarkdownContent>{'**bold** und [link](https://example.com)'}</MarkdownContent>)
    expect(screen.getByText('bold').tagName).toBe('STRONG')
    const link = screen.getByRole('link', { name: 'link' })
    expect(link).toHaveAttribute('href', 'https://example.com')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow')
  })

  it('renders GFM tables and strikethrough', () => {
    render(<MarkdownContent>{'| A | B |\n|---|---|\n| 1 | ~~2~~ |'}</MarkdownContent>)
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('2').tagName).toBe('DEL')
  })

  it('renders legacy plain-text content unchanged (backward compatibility)', () => {
    render(<MarkdownContent>{'Einfach nur Text ohne Formatierung.'}</MarkdownContent>)
    expect(screen.getByText('Einfach nur Text ohne Formatierung.')).toBeInTheDocument()
  })
})
