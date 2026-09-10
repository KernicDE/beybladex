// lib/markdownFieldCaps.ts
// Single source of truth for the character caps of the six Markdown-enabled free-text
// fields (Phase 8). Every server-side validation that accepts one of these fields imports
// its cap from here, and the forms' MarkdownEditor enforces the same cap client-side —
// tests/unit/markdown-editor.test.tsx asserts both sides agree, per field.
export const BIO_MAX = 500
export const CLUB_DESCRIPTION_MAX = 1000
export const RULESET_DESCRIPTION_MAX = 1000
export const TOURNAMENT_DESCRIPTION_MAX = 2000
export const PART_REQUEST_NOTES_MAX = 500
export const RATING_COMMENT_MAX = 500
