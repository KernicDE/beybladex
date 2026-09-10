// lib/media.ts (Phase 11, item 0)
// THE generic image pipeline — built once, consumed by every image-upload need (part/set
// images via catalog proposals and curator direct-create, event header images). One
// upload → sharp resize/crop to the caller's target → WebP → one MediaAsset row + one file
// ("<id>.webp") on the persistent volume.
//
// - No external image API (zero-external-CDN guarantee): sharp is npm-bundled.
// - Authorization is the CALLER's job (per-consumer, see items 1 and 5) — this module is a
//   pure processing/storage utility, not an authz boundary.
// - Target dimensions are decided at the call site and documented there, not hardcoded here.
// - The volume is the real persistence boundary: the container filesystem is ephemeral
//   (Watchtower recreates on every deploy), so MEDIA_UPLOADS_DIR must point at the
//   bind-mounted `media_uploads:` volume in compose.yml.
import { mkdir, readFile, writeFile } from 'node:fs/promises'
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

  const asset = await prisma.mediaAsset.create({
    data: {
      filename: file.name || 'upload',
      mimeType: 'image/webp', // normalized — the stored bytes are always WebP
      width,
      height,
      sizeBytes: buffer.byteLength,
      uploadedById,
    },
  })

  await mkdir(mediaDir(), { recursive: true })
  await writeFile(mediaFilePath(asset.id), buffer)
  return { id: asset.id, width, height, sizeBytes: buffer.byteLength }
}

/** Reads a stored asset's bytes (throws if the file is missing). */
export async function readMediaFile(assetId: string): Promise<Buffer> {
  return readFile(mediaFilePath(assetId))
}
