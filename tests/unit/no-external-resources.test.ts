// tests/unit/no-external-resources.test.ts
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) collectSourceFiles(full, acc)
    else if (/\.(tsx?|css|html)$/.test(entry.name)) acc.push(full)
  }
  return acc
}

const FORBIDDEN = [/fonts\.googleapis\.com/, /unpkg\.com/, /cdn\.jsdelivr\.net/, /cdnjs\.cloudflare\.com/]

describe('zero external CDN resources', () => {
  it('no source file references a forbidden external asset host', () => {
    const files = collectSourceFiles(join(process.cwd(), 'app')).concat(collectSourceFiles(join(process.cwd(), 'components')))
    for (const file of files) {
      const content = readFileSync(file, 'utf-8')
      for (const pattern of FORBIDDEN) {
        expect(pattern.test(content), `${file} references forbidden host ${pattern}`).toBe(false)
      }
    }
  })
})
