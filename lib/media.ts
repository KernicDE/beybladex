// lib/media.ts (Phase 11, item 0)
// THE generic image pipeline — built once, consumed by every image-upload need (part/set
// images via catalog proposals and curator direct-create, event header images). One
// upload → sharp resize/crop to the caller's target → WebP → one MediaAsset row + one file
// ("<id>.webp") on the persistent volume. Ordering rule [RC2 #52]: the file is written BEFORE
// the MediaAsset row is inserted, so a failed volume write can never leave an orphaned row.
//
// - No external image API (zero-external-CDN guarantee): sharp is npm-bundled.
// - Authorization is the CALLER's job (per-consumer, see items 1 and 5) — this module is a
//   pure processing/storage utility, not an authz boundary.
// - Target dimensions are decided at the call site and documented there, not hardcoded here.
// - The volume is the real persistence boundary: the container filesystem is ephemeral
//   (Watchtower recreates on every deploy), so MEDIA_UPLOADS_DIR must point at the
//   bind-mounted `media_uploads:` volume in compose.yml.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import sharp from 'sharp'
import { prisma } from '@/lib/db'

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 // 5 MB cap per upload
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])

export interface MediaTarget {
  width: number
  height: number
  fit: 'cover' | 'contain'
}

// Per-context targets, kept at the consumer (per the phase spec) — these are the shared
// constants those call sites document against.
/** Part/Set catalog images: fixed square crop for the collection/builds grids. */
export const PART_IMAGE_TARGET: MediaTarget = { width: 512, height: 512, fit: 'cover' }
/** Event header images: fixed wide aspect-ratio crop for the detail-page banner. The list
 *  thumbnail on /events renders a cropped excerpt of the SAME stored asset at display size
 *  (object-fit) — one MediaAsset per upload, no second stored variant. */
export const EVENT_HEADER_TARGET: MediaTarget = { width: 1200, height: 400, fit: 'cover' }
/** User avatars: fixed square crop for the profile-page header circle and the UserMenu
 *  button. Rendered small (32–64 px) but stored at 256 so the image stays crisp on
 *  high-DPI displays without a second stored variant. */
export const AVATAR_TARGET: MediaTarget = { width: 256, height: 256, fit: 'cover' }

export function mediaDir(): string {
  return process.env.MEDIA_UPLOADS_DIR ?? path.join(process.cwd(), 'media_uploads')
}

export function mediaFilePath(assetId: string): string {
  // The asset's own id, validated as a uuid by the caller, names the file — no user input
  // ever reaches the path.
  return path.join(mediaDir(), `${assetId}.webp`)
}

export interface ProcessedImage {
  buffer: Buffer
  width: number
  height: number
}

/** [FIX] Duck-typed File check, used by every upload route instead of `x instanceof File`.
 *  The strict instanceof check silently failed under the test suite's jsdom environment
 *  (vitest.config.mts): jsdom ships its OWN File/FormData/Request implementation, and a
 *  Request constructed with jsdom's FormData does not reliably round-trip
 *  `form.get('field') instanceof File` against the GLOBAL File constructor a route module
 *  sees — a genuine realm-mismatch class of bug, not test-only trivia (the same mismatch can
 *  occur between different fetch-polyfill packages in real deployments too, e.g. undici vs a
 *  proxy/edge runtime's own File). Structural checks (the actual properties every caller here
 *  needs: type/size/arrayBuffer) are robust regardless of which realm constructed the object. */
export function isUploadedFile(value: unknown): value is File {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string' &&
    typeof (value as { size?: unknown }).size === 'number' &&
    typeof (value as { arrayBuffer?: unknown }).arrayBuffer === 'function'
  )
}

/** Validates the file (image type + size cap) and normalizes it to the target dimensions as
 *  WebP. Pure processing — no storage, no DB; unit-testable without infrastructure. */
export async function processImage(file: File, target: MediaTarget): Promise<ProcessedImage> {
  if (!ALLOWED_MIME.has(file.type)) throw new Error('invalid_file_type')
  if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) throw new Error('file_too_large')

  const pipeline = sharp(await file.arrayBuffer(), { failOn: 'error' })
    .resize(target.width, target.height, { fit: target.fit })
    .webp({ quality: 85 })

  const { data, info } = await pipeline.toBuffer({ resolveWithObject: true })
  return { buffer: data, width: info.width, height: info.height }
}

/** Full pipeline: process + persist on the volume + insert the MediaAsset row. */
export async function processAndStoreImage(
  file: File,
  target: MediaTarget,
  uploadedById: string,
): Promise<{ id: string; width: number; height: number; sizeBytes: number }> {
  const { buffer, width, height } = await processImage(file, target)

  // [RC2 #52] File FIRST, DB row SECOND. The asset id is generated here (the schema default is
  // the same uuid()), the file is named after it and written to the volume, and only a
  // successful writeFile is followed by the MediaAsset insert. The old order (row first) left
  // an orphaned MediaAsset row — referencing a file that 404s forever — whenever the volume
  // write failed.
  const id = randomUUID()
  await mkdir(mediaDir(), { recursive: true })
  await writeFile(mediaFilePath(id), buffer)
  await prisma.mediaAsset.create({
    data: {
      id,
      filename: file.name || 'upload',
      mimeType: 'image/webp', // normalized — the stored bytes are always WebP
      width,
      height,
      sizeBytes: buffer.byteLength,
      uploadedById,
    },
  })
  return { id, width, height, sizeBytes: buffer.byteLength }
}

/** Reads a stored asset's bytes (throws if the file is missing). */
export async function readMediaFile(assetId: string): Promise<Buffer> {
  return readFile(mediaFilePath(assetId))
}
