import { describe, it, expect } from 'vitest'
import manifest from '@/app/manifest'

describe('PWA manifest', () => {
  it('declares standalone display and the required icon sizes', () => {
    const m = manifest()
    expect(m.display).toBe('standalone')
    const sizes = m.icons?.map((i) => i.sizes)
    expect(sizes).toContain('192x192')
    expect(sizes).toContain('512x512')
    expect(m.icons?.some((i) => i.purpose === 'maskable')).toBe(true)
  })
})
