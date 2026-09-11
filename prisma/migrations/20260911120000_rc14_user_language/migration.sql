-- RC14 #17: per-user interface language (lib/i18n/locales.ts's SUPPORTED_LOCALES, default de).
-- Plain TEXT, not an enum: adding a language must stay a code-only change.
ALTER TABLE "User" ADD COLUMN "language" TEXT NOT NULL DEFAULT 'de';
