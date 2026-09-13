// lib/ratingInput.ts (MVP4, #139/#143)
// Validierung des Rating-Bodys (Sterne 1–5 ganzzahlig, optionaler Markdown-Kommentar mit Cap)
// — pure Funktion, geteilt von der polymorphen API (app/api/ratings/route.ts) und dem
// Legacy-Build-Pfad (app/api/builds/[id]/ratings/route.ts, der an die polymorphe API delegiert).
import { RATING_COMMENT_MAX } from '@/lib/markdownFieldCaps'

export interface ParsedRatingBody {
  stars?: number
  comment?: string | null
  errors?: string[]
}

export function parseRatingBody(body: unknown): ParsedRatingBody {
  if (typeof body !== 'object' || body === null) return { errors: ['invalid_body'] }
  const b = body as Record<string, unknown>
  const errors: string[] = []
  let stars: number | undefined
  let comment: string | null | undefined
  if (typeof b.stars !== 'number' || !Number.isInteger(b.stars) || b.stars < 1 || b.stars > 5) {
    errors.push('invalid_stars')
  } else stars = b.stars
  if (b.comment !== undefined) {
    if (b.comment === null) comment = null
    else if (typeof b.comment === 'string') comment = b.comment.trim().slice(0, RATING_COMMENT_MAX) || null
    else errors.push('invalid_comment')
  }
  return errors.length > 0 ? { errors } : { stars, comment }
}
