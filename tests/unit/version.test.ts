// tests/unit/version.test.ts (issue #77)
// Covers lib/version.ts + app/api/version/route.ts: the deploy version is read from
// the APP_VERSION env var (baked into the Docker image by deploy.yml), with a
// documented non-prod fallback outside the image.
import { describe, it, expect, vi, afterEach } from 'vitest'

const ENV_KEY = 'APP_VERSION'

async function importFresh() {
  vi.resetModules()
  return import('@/app/api/version/route')
}

describe('deploy version (issue #77)', () => {
  afterEach(() => {
    delete process.env[ENV_KEY]
  })

  it('falls back to the documented dev marker when APP_VERSION is unset', async () => {
    delete process.env[ENV_KEY]
    const { GET } = await importFresh()
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ version: '0.0.0-dev+local', date: '0.0.0-dev', commit: 'local' })
  })

  it('reports the baked image version as date + short SHA', async () => {
    process.env[ENV_KEY] = '2026.09.10+2282d4c'
    const { GET } = await importFresh()
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ version: '2026.09.10+2282d4c', date: '2026.09.10', commit: '2282d4c' })
  })

  it('exposes the version via lib/version constants for server components (footer)', async () => {
    process.env[ENV_KEY] = '2026.09.11+abcdef1'
    vi.resetModules()
    const { APP_VERSION, VERSION_DATE, VERSION_COMMIT } = await import('@/lib/version')
    expect(APP_VERSION).toBe('2026.09.11+abcdef1')
    expect(VERSION_DATE).toBe('2026.09.11')
    expect(VERSION_COMMIT).toBe('abcdef1')
  })
})
