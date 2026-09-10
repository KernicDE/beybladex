// tests/unit/media-pipeline.test.ts
// Phase 11, item 0: processImage normalizes any accepted image to the caller's target
// dimensions and always outputs WebP — the acceptance-critical proof for the shared pipeline.
// Pure processing, no DB/volume — safe to run anywhere (no infra needed).
import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { processImage, PART_IMAGE_TARGET, EVENT_HEADER_TARGET } from '@/lib/media'

async function makePngFile(width: number, height: number): Promise<File> {
  const buffer = await sharp({
    create: { width, height, channels: 4, background: { r: 100, g: 150, b: 200, alpha: 1 } },
  })
    .png()
    .toBuffer()
  return new File([new Uint8Array(buffer)], 'test.png', { type: 'image/png' })
}

describe('lib/media processImage', () => {
  it('resizes a non-square source to the PART_IMAGE_TARGET square and outputs WebP', async () => {
    const file = await makePngFile(800, 300)
    const result = await processImage(file, PART_IMAGE_TARGET)
    expect(result.width).toBe(PART_IMAGE_TARGET.width)
    expect(result.height).toBe(PART_IMAGE_TARGET.height)
    const meta = await sharp(result.buffer).metadata()
    expect(meta.format).toBe('webp')
  })

  it('resizes to the EVENT_HEADER_TARGET wide aspect ratio', async () => {
    const file = await makePngFile(500, 500)
    const result = await processImage(file, EVENT_HEADER_TARGET)
    expect(result.width).toBe(EVENT_HEADER_TARGET.width)
    expect(result.height).toBe(EVENT_HEADER_TARGET.height)
  })

  it('rejects a disallowed MIME type', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'evil.svg', { type: 'image/svg+xml' })
    await expect(processImage(file, PART_IMAGE_TARGET)).rejects.toThrow('invalid_file_type')
  })

  it('rejects an oversized file', async () => {
    const big = new Uint8Array(6 * 1024 * 1024) // > MAX_UPLOAD_BYTES (5 MB)
    const file = new File([big], 'huge.png', { type: 'image/png' })
    await expect(processImage(file, PART_IMAGE_TARGET)).rejects.toThrow('file_too_large')
  })
})
