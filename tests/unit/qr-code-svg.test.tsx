// tests/unit/qr-code-svg.test.tsx (hotfix #98)
// The SSR-safety contract of QrCodeSvg, seam-free (pure component):
//  - Server-rendered HTML must NOT contain the SVG markup — the raw-HTML island in streamed
//    server HTML is what crashed /events/[id] hydration (#418/#441). An empty placeholder must
//    be all a viewer's first paint contains.
//  - After hydration (effects ran), the trusted server-generated SVG must be present.
import { render } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { QrCodeSvg } from '@/components/tournament/QrCodeSvg'

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1H0z"/></svg>'

describe('QrCodeSvg (issue #98)', () => {
  it('server-rendered HTML contains no SVG markup — only the placeholder', () => {
    const html = renderToStaticMarkup(<QrCodeSvg svg={SVG} />)
    expect(html).not.toContain('<svg')
    expect(html).not.toContain('<path')
    // The placeholder reserves the layout box so nothing shifts when the QR appears.
    expect(html).toContain('h-48')
    expect(html).toContain('w-48')
  })

  it('injects the server-generated SVG after hydration', () => {
    const { container } = render(<QrCodeSvg svg={SVG} />)
    expect(container.querySelector('svg')).not.toBeNull()
    expect(container.querySelector('path')).not.toBeNull()
  })
})
