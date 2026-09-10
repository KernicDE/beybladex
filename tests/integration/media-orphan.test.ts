// tests/integration/media-orphan.test.ts
// [RC2 #52] processAndStoreImage must write the file BEFORE inserting the MediaAsset row: a
// failing writeFile used to leave an orphaned DB row whose file 404s forever. The test mocks
// writeFile to reject and asserts no MediaAsset row survives; the success path (real write into
// a temp MEDIA_UPLOADS_DIR) proves the reordered pipeline still stores file + row together.
// Integration — CI-only (real Prisma for the row assertions).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mkdtemp, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, writeFile: vi.fn(actual.writeFile) }
})
const { writeFile } = await import('node:fs/promises')
const mockWriteFile = vi.mocked(writeFile)

const { processAndStoreImage, PART_IMAGE_TARGET } = await import('@/lib/media')
const { prisma } = await import('@/lib/db')

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
    mockWriteFile.mockClear()
    vi.unstubAllEnvs()
  })

  it('leaves no orphaned MediaAsset row when the volume write fails', async () => {
    const suffix = Date.now().toString(36)
    const uploader = await prisma.user.create({ data: { username: `mo_upl_${suffix}`, passwordHash: 'x' } })
    const before = await prisma.mediaAsset.count({ where: { uploadedById: uploader.id } })
    expect(before).toBe(0)

    mockWriteFile.mockRejectedValueOnce(new Error('ENOSPC: no space left on device'))
    await expect(processAndStoreImage(await makePngFile(64, 64), PART_IMAGE_TARGET, uploader.id)).rejects.toThrow('ENOSPC')

    // The failed write must not have inserted a DB row (old behavior: row first → orphan).
    const after = await prisma.mediaAsset.count({ where: { uploadedById: uploader.id } })
    expect(after).toBe(0)

    await prisma.user.delete({ where: { id: uploader.id } })
  })

  it('still stores file and row together on success', async () => {
    const suffix = Date.now().toString(36)
    const dir = await mkdtemp(path.join(tmpdir(), `beybladex-media-${suffix}-`))
    vi.stubEnv('MEDIA_UPLOADS_DIR', dir)
    const uploader = await prisma.user.create({ data: { username: `mo_ok_${suffix}`, passwordHash: 'x' } })

    const result = await processAndStoreImage(await makePngFile(64, 64), PART_IMAGE_TARGET, uploader.id)
    const row = await prisma.mediaAsset.findUnique({ where: { id: result.id } })
    expect(row).toMatchObject({ id: result.id, mimeType: 'image/webp', uploadedById: uploader.id })
    await access(path.join(dir, `${result.id}.webp`))

    await prisma.mediaAsset.delete({ where: { id: result.id } })
    await prisma.user.delete({ where: { id: uploader.id } })
    await rm(dir, { recursive: true, force: true })
  })
})
