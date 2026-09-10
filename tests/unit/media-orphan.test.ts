// tests/unit/media-orphan.test.ts
// [RC2 #52] processAndStoreImage must write the file BEFORE inserting the MediaAsset row: a
// failing writeFile used to leave an orphaned DB row whose file 404s forever. The failure is
// simulated WITHOUT module mocks — vitest 5 does not route node:-builtin mocks into lib imports
// (verified empirically) — instead MEDIA_UPLOADS_DIR points at a read-only directory, so the
// writeFile genuinely fails with EACCES. prisma is mocked at the '@/lib/db' seam (same pattern
// as the auth mocks throughout the suite): "no create call" == "no orphaned row". The success
// path (real write into a temp MEDIA_UPLOADS_DIR) proves the reordered pipeline still stores
// file + row together, and that the file is named after the pre-generated asset id.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtemp, rm, access, chmod } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

vi.mock('@/lib/db', () => ({
  prisma: { mediaAsset: { create: vi.fn() } },
}))
const { prisma } = await import('@/lib/db')
const mockCreate = vi.mocked(prisma.mediaAsset.create)

const { processAndStoreImage, mediaFilePath, PART_IMAGE_TARGET } = await import('@/lib/media')

async function makePngFile(width: number, height: number): Promise<File> {
  const buffer = await sharp({
    create: { width, height, channels: 4, background: { r: 100, g: 150, b: 200, alpha: 1 } },
  })
    .png()
    .toBuffer()
  return new File([new Uint8Array(buffer)], 'race.png', { type: 'image/png' })
}

describe('processAndStoreImage failure ordering', () => {
  afterEach(() => {
    mockCreate.mockReset()
    vi.unstubAllEnvs()
  })

  it('leaves no orphaned MediaAsset row when the volume write fails', async () => {
    // Read-only target directory: mkdir(recursive) succeeds on the existing dir, the
    // writeFile genuinely fails with EACCES — the old code had already inserted the row by
    // then, the new code hasn't reached the insert yet.
    const dir = await mkdtemp(path.join(tmpdir(), 'beybladex-media-ro-'))
    await chmod(dir, 0o555)
    vi.stubEnv('MEDIA_UPLOADS_DIR', dir)
    try {
      await expect(processAndStoreImage(await makePngFile(64, 64), PART_IMAGE_TARGET, 'user-1')).rejects.toThrow()
    } finally {
      await chmod(dir, 0o755)
      await rm(dir, { recursive: true, force: true })
    }
    // No orphaned row: the insert never ran.
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('still stores file and row together on success', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'beybladex-media-ok-'))
    vi.stubEnv('MEDIA_UPLOADS_DIR', dir)
    try {
      mockCreate.mockResolvedValue({ id: 'ignored' } as never)
      const result = await processAndStoreImage(await makePngFile(64, 64), PART_IMAGE_TARGET, 'user-1')
      // Row insert ran exactly once, carrying the same pre-generated id the file was named after.
      expect(mockCreate).toHaveBeenCalledTimes(1)
      expect(mockCreate.mock.calls[0][0]).toMatchObject({
        data: { id: result.id, mimeType: 'image/webp', uploadedById: 'user-1' },
      })
      await access(mediaFilePath(result.id))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
