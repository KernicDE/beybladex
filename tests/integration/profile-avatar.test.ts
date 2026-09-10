// @vitest-environment node
// [FIX] The suite-wide jsdom environment (vitest.config.mts) corrupts binary File content sent
// through a real FormData→Request→.formData() round trip — a 231-byte PNG built by sharp came
// back as a 9-byte file named "blob" on the other side, which sharp then rejected as unparsable
// (surfaced as a 400 invalid_image, not a crash — the earlier isUploadedFile duck-typing fix
// was necessary but not sufficient; the multipart body itself was already mangled by jsdom
// before the route ever saw it). This file's own tests are pure API-route tests with no DOM
// dependency, so overriding to Node's native fetch/FormData/File implementation (which
// round-trips correctly, verified locally) is the fix — not a workaround for a test-only
// artifact, since the same corruption would hit any real caller whose polyfilled fetch stack
// resembles jsdom's.
//
// tests/integration/profile-avatar.test.ts
// Phase 21, items 1 + 2 + 5: POST /api/profile/avatar and DELETE /api/profile/avatar are
// session-required and self-only (there is no target-user param — a session IS the whole
// authz scope, so the negative test is anonymous → 401 on BOTH verbs). Upload sets
// User.avatarImageId; DELETE clears it back to null; account erasure removes BOTH the
// reference and the underlying MediaAsset row AND its on-volume file (avatars are
// personal-only data — unlike the Phase 11 tombstone treatment of catalog MediaAssets).
// CI-only (Postgres/Redis + the media volume).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { access, rm } from 'node:fs/promises'
import sharp from 'sharp'
import { POST, DELETE } from '@/app/api/profile/avatar/route'
import { eraseOrAnonymizeUser } from '@/lib/accountErasure'
import { mediaFilePath } from '@/lib/media'
import { prisma } from '@/lib/db'
import { auth } from '@/lib/auth'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const mockAuth = vi.mocked(auth)

function asSession(value: { id: string; name: string } | null) {
  return (value ? { user: value, expires: new Date(Date.now() + 86400_000).toISOString() } : null) as unknown as NonNullable<Awaited<ReturnType<typeof auth>>>
}

async function pngFile(name = 'avatar.png'): Promise<File> {
  const buffer = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 0, g: 200, b: 255 } } })
    .png()
    .toBuffer()
  return new File([buffer], name, { type: 'image/png' })
}

function imageRequest(url: string, file: File) {
  const form = new FormData()
  form.set('image', file)
  return new Request(url, { method: 'POST', body: form })
}

describe('profile avatar (Phase 21)', () => {
  afterEach(() => {
    mockAuth.mockReset()
  })

  it('POST and DELETE are session-required: anonymous gets 401 on both and nothing changes', async () => {
    const suffix = Date.now().toString(36)
    const user = await prisma.user.create({ data: { username: `ava_anon_${suffix}`, passwordHash: 'x' } })
    mockAuth.mockResolvedValue(asSession(null))

    const post = await POST(imageRequest('http://localhost/api/profile/avatar', await pngFile()))
    expect(post.status).toBe(401)
    const del = await DELETE()
    expect(del.status).toBe(401)
    expect((await prisma.user.findUnique({ where: { id: user.id } }))!.avatarImageId).toBeNull()

    await prisma.user.delete({ where: { id: user.id } })
  })

  it('upload stores the image and sets avatarImageId; DELETE clears it back to null', async () => {
    const suffix = Date.now().toString(36)
    const user = await prisma.user.create({ data: { username: `ava_up_${suffix}`, passwordHash: 'x' } })
    mockAuth.mockResolvedValue(asSession({ id: user.id, name: user.username }))
    const url = 'http://localhost/api/profile/avatar'

    const res = await POST(imageRequest(url, await pngFile()))
    expect(res.status).toBe(200)
    const { avatarImageId } = (await res.json()) as { avatarImageId: string }

    const row = await prisma.user.findUnique({ where: { id: user.id } })
    expect(row!.avatarImageId).toBe(avatarImageId)
    const asset = await prisma.mediaAsset.findUnique({ where: { id: avatarImageId } })
    expect(asset).not.toBeNull()
    expect(asset!.mimeType).toBe('image/webp') // normalized by the generic pipeline
    expect(asset!.uploadedById).toBe(user.id)
    // the processed file actually landed on the volume
    await expect(access(mediaFilePath(avatarImageId))).resolves.toBeUndefined()

    const del = await DELETE()
    expect(del.status).toBe(200)
    expect((await prisma.user.findUnique({ where: { id: user.id } }))!.avatarImageId).toBeNull()

    // cleanup (the DELETE route intentionally leaves the asset orphaned, same tradeoff as
    // the header-image route — remove row + file so the suite stays deterministic)
    await prisma.mediaAsset.delete({ where: { id: avatarImageId } }).catch(() => {})
    await rm(mediaFilePath(avatarImageId), { force: true })
    await prisma.user.delete({ where: { id: user.id } })
  })

  it('account erasure removes the avatar reference, the MediaAsset row, AND the on-volume file', async () => {
    const suffix = Date.now().toString(36)
    const user = await prisma.user.create({ data: { username: `ava_era_${suffix}`, passwordHash: 'x' } })
    mockAuth.mockResolvedValue(asSession({ id: user.id, name: user.username }))

    const res = await POST(imageRequest('http://localhost/api/profile/avatar', await pngFile()))
    expect(res.status).toBe(200)
    const { avatarImageId } = (await res.json()) as { avatarImageId: string }
    await expect(access(mediaFilePath(avatarImageId))).resolves.toBeUndefined()

    await eraseOrAnonymizeUser(user.id)

    const anonymized = await prisma.user.findUnique({ where: { id: user.id } })
    expect(anonymized!.avatarImageId).toBeNull()
    expect(await prisma.mediaAsset.findUnique({ where: { id: avatarImageId } })).toBeNull()
    await expect(access(mediaFilePath(avatarImageId))).rejects.toThrow() // file is gone too

    // the erased row itself stays (anonymized in place, never hard-deleted)
    await prisma.user.delete({ where: { id: user.id } })
    await prisma.user.deleteMany({ where: { username: 'geloeschte-nutzer' } })
  })
})
